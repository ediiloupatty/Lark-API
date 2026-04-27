import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import crypto from 'crypto';
import { sendPushToAdmins, saveNotification } from '../services/firebaseService';
import { sendWhatsApp, buildNewOrderMessage, buildStatusUpdateMessage } from '../services/whatsappService';
import { uploadToR2, isR2Configured } from '../services/r2Service';

function generateTrackingCode() {
  return 'ORD-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// GET /api/v1/sync/orders
export const getOrders = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    const statusFilter = req.query.status as string || '';
    const search = req.query.search as string || '';
    const customerId = req.query.customer_id as string || '';
    const orderIdStr = req.query.id as string || '';
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string || '20')), 100); // Fix BH-2: max 100
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.id, o.client_id, o.server_version, o.updated_at,
             o.tracking_code, o.tgl_order, o.tgl_diproses, o.tgl_siap, o.tgl_selesai,
             o.total_harga, o.status, o.metode_antar, 
             o.estimasi_tanggal, o.estimasi_waktu, o.catatan, o.paket_id, o.alamat_jemput,
             c.nama as nama_pelanggan, c.no_hp, c.alamat as alamat_pelanggan,
             p.status_pembayaran, p.tgl_pembayaran, p.konfirmasi_pada, p.jumlah_bayar, p.metode_pembayaran as metode_bayar,
             ot.nama as outlet_nama, ot.alamat as outlet_alamat, ot.phone as outlet_phone,
             u.nama as user_nama
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
      LEFT JOIN outlets ot ON o.outlet_id = ot.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.tenant_id = $1
    `;
    const params: any[] = [tenantId];
    let pIdx = 2;

    if (orderIdStr) {
      query += ` AND o.id = $2`;
      const orders = await db.$queryRawUnsafe<any[]>(query, tenantId, parseInt(orderIdStr));
      if (orders.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });
      }
      
      const order = orders[0];
      let items: any[] = [];
      try {
        items = await db.$queryRawUnsafe<any[]>(
          `SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, pk.nama_paket as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           LEFT JOIN paket_laundry pk ON s.paket_id = pk.id
           WHERE od.order_id = $1`,
          order.id
        );
      } catch (e) {
        items = await db.$queryRawUnsafe<any[]>(
          `SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, NULL as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           WHERE od.order_id = $1`,
          order.id
        );
      }
      
      const formattedItems = items.map((it: any) => ({
         ...it,
         harga: Number(it.harga || 0),
         subtotal: Number(it.subtotal || 0),
         harga_per_kg: Number(it.harga_per_kg || 0)
      }));
      
      const finalOrder = {
        ...order,
        total_harga: Number(order.total_harga || 0),
        server_version: Number(order.server_version || 0),
        items: formattedItems,
        layanan_nama: formattedItems.length > 0 ? formattedItems[0].nama_item : null,
        harga_per_kg: formattedItems.length > 0 ? formattedItems[0].harga_per_kg : null,
        berat: formattedItems.length > 0 ? formattedItems[0].berat : null,
        paket_nama: formattedItems.length > 0 ? formattedItems[0].paket_nama : null,
        metode_bayar: order.metode_bayar || 'cash',
        jumlah_bayar: Number(order.jumlah_bayar || 0),
      };
      
      return res.json({
        status: 'success',
        message: 'Detail pesanan ditemukan.',
        data: finalOrder
      });
    }

    if (customerId) {
      query += ` AND o.customer_id = $${pIdx++}`;
      params.push(parseInt(customerId));
    }

    if (!isAdmin && staffOutletId) {
      query += ` AND o.outlet_id = $${pIdx++}`;
      params.push(staffOutletId);
    }

    if (statusFilter) {
      query += ` AND o.status = $${pIdx++}::order_status`;
      params.push(statusFilter);
    }

    if (search) {
      query += ` AND (c.nama ILIKE $${pIdx} OR o.tracking_code ILIKE $${pIdx++})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY o.tgl_order DESC LIMIT $${pIdx++} OFFSET $${pIdx++}`;
    params.push(limit, offset);

    const orders = await db.$queryRawUnsafe<any[]>(query, ...params);

    // Fetch order details mapping
    let itemsMap: Record<number, any[]> = {};
    if (orders.length > 0) {
      const orderIds = orders.map((o: any) => o.id);
      
      try {
        const items = await db.$queryRawUnsafe<any[]>(
          `SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, pk.nama_paket as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           LEFT JOIN paket_laundry pk ON s.paket_id = pk.id
           WHERE od.order_id = ANY($1::int[])`,
          orderIds
        );
        for (const item of items) {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push({
            ...item,
            harga: Number(item.harga || 0),
            subtotal: Number(item.subtotal || 0),
            harga_per_kg: Number(item.harga_per_kg || 0)
          });
        }
      } catch (e) {
        // Fallback in case paket_laundry does not exist or relation is not there
        const items = await db.$queryRawUnsafe<any[]>(
          `SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, NULL as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           WHERE od.order_id = ANY($1::int[])`,
          orderIds
        );
        for (const item of items) {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push({
            ...item,
            harga: Number(item.harga || 0),
            subtotal: Number(item.subtotal || 0),
            harga_per_kg: Number(item.harga_per_kg || 0)
          });
        }
      }
    }

    const formattedOrders = orders.map(o => {
      const itms = itemsMap[o.id] || [];
      return {
        ...o,
        total_harga: Number(o.total_harga || 0),
        server_version: Number(o.server_version || 0),
        items: itms,
        layanan_nama: itms.length > 0 ? itms[0].nama_item : null,
        harga_per_kg: itms.length > 0 ? itms[0].harga_per_kg : null,
        berat: itms.length > 0 ? itms[0].berat : null,
        paket_nama: itms.length > 0 ? itms[0].paket_nama : null,
        metode_bayar: o.metode_bayar || 'cash',
        jumlah_bayar: Number(o.jumlah_bayar || 0),
      };
    });

    res.json({
      status: 'success',
      message: 'Data pesanan berhasil diambil.',
      data: { orders: formattedOrders, summary: null, counts: null }
    });
  } catch (err: any) {
    console.error('[GetOrders Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data pesanan.' });
  }
};

// POST /api/v1/sync/create-order
export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const userId = req.user?.user_id;
    let targetOutletId = req.user?.outlet_id || null;

    const { 
      customer_id, 
      items, 
      client_id, 
      pickup_method, 
      delivery_method, 
      pickup_zone, 
      delivery_zone, 
      pickup_address, 
      delivery_address, 
      metode_bayar, 
      status_bayar,
      metode_antar,
      catatan
    } = req.body;

    if (!customer_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Customer ID dan Items wajib diisi.' });
    }

    // [SECURITY FIX] Tenant Boundary Check for Customer
    const parsedCustomerId = parseInt(customer_id);
    const verifyCust = await db.customers.findFirst({
      where: { id: parsedCustomerId, tenant_id: tenantId, deleted_at: null }
    });
    if (!verifyCust) {
      console.warn(`[Create Order] IDOR Attempt/Invalid Customer ID: ${customer_id} oleh Tenant ${tenantId}`);
      return res.status(403).json({ status: 'error', message: 'Pelanggan tidak valid atau tidak ditemukan di toko Anda.' });
    }

    // [SECURITY FIX] Validate Outlet ID
    let safeOutletId = req.user?.outlet_id || null;
    if (isAdmin && req.body.outlet_id) {
      const verifyOutlet = await db.outlets.findFirst({
        where: { id: parseInt(req.body.outlet_id), tenant_id: tenantId }
      });
      if (verifyOutlet) {
        safeOutletId = verifyOutlet.id;
      }
    }

    // Idempotency check
    if (client_id) {
      const existing = await db.$queryRawUnsafe<any[]>(
        `SELECT id, tracking_code, total_harga, status FROM orders WHERE tenant_id = $1 AND client_id = $2`,
        tenantId, client_id
      );
      if (existing.length > 0) {
        return res.status(200).json({
          status: 'success',
          message: `Pesanan #${existing[0].tracking_code} sudah tersimpan.`,
          data: {
            order_id: existing[0].id,
            tracking_code: existing[0].tracking_code,
            total_amount: Number(existing[0].total_harga),
            status: existing[0].status
          }
        });
      }
    }

    const trackingCode = generateTrackingCode();
    const estimasiTanggal = req.body.estimasi_tanggal || new Date(Date.now() + 3*24*60*60*1000).toISOString().split('T')[0];
    const estimasiWaktu = req.body.estimasi_waktu || 'Pagi (08:00-12:00)';

    // Start Transaction
    const result = await db.$transaction(async (tx) => {
      // Create Order
      const orderData: any = {
        tenant_id: tenantId,
        customer_id: parsedCustomerId,
        status: 'diproses',
        metode_antar: metode_antar || 'antar_sendiri',
        catatan: catatan || '',
        tracking_code: trackingCode,
        estimasi_tanggal: new Date(estimasiTanggal),
        estimasi_waktu: estimasiWaktu,
        outlet_id: safeOutletId,
        client_id: client_id || null,
        server_version: BigInt(Date.now()),
      };

      if (req.body.paket_id) orderData.paket_id = parseInt(req.body.paket_id);
      if (pickup_address) orderData.alamat_jemput = pickup_address;
      if (userId) orderData.user_id = userId;

      const insertedOrder = await tx.orders.create({ data: orderData });
      const orderId = insertedOrder.id;
      
      let totalHarga = 0;

      // Insert Items
      for (const it of items) {
        const sid = parseInt(it.service_id);
        const berat = Number(it.berat || it.qty || 0);
        const jumlah = parseInt(it.jumlah || '0');
        const chargeBasis = berat > 0 ? berat : jumlah;

        if (sid > 0 && chargeBasis > 0) {
          const serviceRow = await tx.services.findFirst({
            where: { id: sid, tenant_id: tenantId, is_active: true },
            select: { harga_per_kg: true }
          });
          if (serviceRow) {
            const price = Number(serviceRow.harga_per_kg);
            const subtotal = chargeBasis * price;
            totalHarga += subtotal;

            await tx.order_details.create({
              data: {
                order_id: orderId,
                service_id: sid,
                jumlah: jumlah > 0 ? jumlah : null,
                berat: berat > 0 ? berat : null,
                harga: price,
                subtotal: subtotal
              }
            });
          }
        }
      }

      // Update Total
      await tx.orders.update({
        where: { id: orderId },
        data: { total_harga: totalHarga }
      });

      // Payments
      const isPayNow = status_bayar === 'sekarang' && totalHarga > 0;
      const payStatus = isPayNow ? 'lunas' : 'pending';
      // Always store the real amount so "Rp 0" never appears in history
      const payAmount = totalHarga;
      
      // Fallback enum mapping for metode_bayar to match Prisma definition
      let paymentMethodStr = metode_bayar || 'cash';
      if (paymentMethodStr !== 'cash' && paymentMethodStr !== 'transfer') {
        paymentMethodStr = 'cash'; // fallback to valid enum
      }

      await tx.payments.create({
        data: {
          tenant_id: tenantId,
          order_id: orderId,
          metode_pembayaran: paymentMethodStr as any,
          jumlah_bayar: payAmount,
          status_pembayaran: payStatus,
          // Set tgl_pembayaran immediately if lunas, so history shows the date
          ...(isPayNow ? { tgl_pembayaran: new Date() } : {}),
          outlet_id: safeOutletId
        }
      });

      return { orderId, totalHarga, trackingCode };
    });

    res.status(201).json({
      status: 'success',
      message: `Pesanan #${result.trackingCode} berhasil dibuat!`,
      data: {
        order_id: result.orderId,
        tracking_code: result.trackingCode,
        total_amount: result.totalHarga,
        status: 'diproses',
        status_pembayaran: status_bayar === 'sekarang' ? 'lunas' : 'pending',
        metode_bayar: status_bayar === 'sekarang' ? metode_bayar : null,
        user_nama: req.user?.nama || req.user?.username || 'Karyawan',
        karyawan_nama: req.user?.nama || req.user?.username || 'Karyawan'
      }
    });

    // ── Kirim push notification ke admin (async, tidak block response) ──
    const creatorName = req.user?.nama || req.user?.username || 'Karyawan';
    const pushTitle = '🧺 Pesanan Baru Masuk!';
    const pushBody = `${creatorName} membuat pesanan #${result.trackingCode} · Rp${Math.round(result.totalHarga).toLocaleString('id-ID')}`;

    // Kirim push ke semua admin di tenant ini
    sendPushToAdmins({
      tenantId: tenantId!,
      title: pushTitle,
      body: pushBody,
      data: {
        type: 'new_order',
        order_id: String(result.orderId),
        tracking_code: result.trackingCode,
      },
    }).catch((e) => console.error('[Push Error]', e));

    // Simpan ke inbox notifikasi untuk semua admin di tenant
    db.users.findMany({
      where: { tenant_id: tenantId, role: { in: ['admin', 'super_admin', 'owner'] as any }, is_active: true, deleted_at: null },
      select: { id: true },
    }).then((admins) => {
      for (const admin of admins) {
        saveNotification({
          tenantId: tenantId!,
          userId: admin.id,
          orderId: result.orderId,
          tipe: 'new_order',
          pesan: pushBody,
        }).catch(() => {});
      }
    }).catch(() => {});

    // ── Kirim WhatsApp otomatis ke pelanggan via Fonnte (async) ──
    db.customers.findFirst({ where: { id: parseInt(customer_id), tenant_id: tenantId! } })
      .then(async (cust) => {
        if (!cust?.no_hp) return;
        const tenant = await db.tenants.findUnique({ where: { id: tenantId! }, select: { name: true } });
        const firstItem = Array.isArray(items) && items.length > 0 ? items[0] : null;
        const svc = firstItem?.service_id
          ? await db.services.findFirst({ where: { id: parseInt(firstItem.service_id) }, select: { nama_layanan: true } })
          : null;
        const msg = buildNewOrderMessage({
          nama_toko: tenant?.name || 'Laundry Kami',
          nama_pelanggan: cust.nama || 'Pelanggan',
          tracking_code: result.trackingCode,
          total_harga: result.totalHarga,
          estimasi_tanggal: req.body.estimasi_tanggal || new Date(Date.now() + 3*24*60*60*1000).toISOString(),
          layanan_nama: svc?.nama_layanan,
        });
        sendWhatsApp({ tenantId: tenantId!, phone: cust.no_hp, message: msg }).catch(() => {});
      })
      .catch(() => {});

  } catch (err: any) {
    console.error('[CreateOrder Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memproses pesanan.' });
  }
};

// PUT /api/v1/sync/update-order-status
export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    // Mobile sends 'order_id', web dashboard may send 'id' — accept both
    const id = req.body.order_id ?? req.body.id;
    const { status } = req.body;

    if (!id || !status) return res.status(400).json({ status: 'error', message: 'ID pesanan dan status wajib diisi.' });

    // ── Validasi: Pesanan tidak boleh "selesai" jika belum lunas ──
    if (status === 'selesai') {
      const [order] = await db.$queryRawUnsafe<any[]>(
        `SELECT o.id, p.status_pembayaran
         FROM orders o
         LEFT JOIN payments p ON p.order_id = o.id AND p.tenant_id = o.tenant_id
         WHERE o.id = $1 AND o.tenant_id = $2
         ORDER BY p.created_at DESC
         LIMIT 1`,
        parseInt(String(id)), tenantId
      );
      if (!order) return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });
      if (order.status_pembayaran !== 'lunas') {
        return res.status(400).json({
          status: 'error',
          message: 'Pesanan tidak bisa diselesaikan sebelum pembayaran lunas. Silakan selesaikan pembayaran terlebih dahulu.',
        });
      }
    }

    let queryUpdates = `status = $1::order_status`;
    const params: any[] = [status, id, tenantId];

    if (status === 'diproses') queryUpdates += `, tgl_diproses = NOW()`;
    if (status === 'siap_diambil' || status === 'siap_diantar') queryUpdates += `, tgl_siap = NOW()`;
    if (status === 'selesai') queryUpdates += `, tgl_selesai = NOW()`;

    queryUpdates += `, server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)`;

    const updated = await db.$queryRawUnsafe<any[]>(
      `UPDATE orders SET ${queryUpdates} WHERE id = $2 AND tenant_id = $3 RETURNING id, status`,
      ...params
    );

    if (updated.length === 0) return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });

    res.json({
      status: 'success',
      message: 'Status pesanan berhasil diperbarui.'
    });

    // ── Kirim WA ke pelanggan saat status berubah (async, tidak block response) ──
    const WA_NOTIFY_STATUSES = ['siap_diambil', 'siap_diantar', 'selesai'];
    if (WA_NOTIFY_STATUSES.includes(status)) {
      db.$queryRawUnsafe<any[]>(
        `SELECT o.tracking_code, c.no_hp, c.nama as nama_pelanggan, t.nama as nama_toko
         FROM orders o
         JOIN customers c ON o.customer_id = c.id
         JOIN tenants t ON o.tenant_id = t.id
         WHERE o.id = $1`, parseInt(String(id))
      ).then(async (rows) => {
        if (!rows[0]?.no_hp) return;
        const r = rows[0];
        const msg = buildStatusUpdateMessage({
          nama_toko: r.nama_toko || 'Laundry Kami',
          nama_pelanggan: r.nama_pelanggan || 'Pelanggan',
          tracking_code: r.tracking_code,
          status,
        });
        if (msg) sendWhatsApp({ tenantId: tenantId!, phone: r.no_hp, message: msg }).catch(() => {});
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error('[UpdateOrderStatus Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui status.' });
  }
};

// POST /api/v1/sync/pay-order
export const payOrder = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { order_id, jumlah_bayar } = req.body;

    // Accept both field name variants the mobile app might send
    // Fix BC-3: Validasi enum agar tidak inject nilai sembarang ke DB
    const VALID_PAYMENT_METHODS = ['cash', 'transfer', 'qris'];
    const rawMethod = req.body.metode_bayar || req.body.metode_pembayaran || 'cash';
    const metodeBayar: string = VALID_PAYMENT_METHODS.includes(rawMethod) ? rawMethod : 'cash';

    if (!order_id) {
      return res.status(400).json({ status: 'error', message: 'Data tidak lengkap.' });
    }

    const orderRes = await db.$queryRawUnsafe<any[]>(
      `SELECT id, total_harga, tracking_code FROM orders WHERE id = $1 AND tenant_id = $2`, parseInt(order_id), tenantId
    );
    if (orderRes.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Order tidak ditemukan.' });
    }

    // jumlah_bayar is optional — fall back to order total if not provided by mobile
    const jumlahBayar: number = jumlah_bayar
      ? parseFloat(jumlah_bayar)
      : parseFloat(orderRes[0].total_harga || 0);

    const confirmingUserId: number = req.user?.user_id || 0;

    // ── Upload bukti pembayaran ke R2 (opsional) ──────────────────
    let buktiUrl: string | null = null;
    const multerFile = (req as any).file;
    if (multerFile && isR2Configured()) {
      try {
        const trackingCode = orderRes[0].tracking_code || `ORD${order_id}`;
        buktiUrl = await uploadToR2(multerFile, 'payment', tenantId!, trackingCode);
      } catch (uploadErr: any) {
        console.error('[PayOrder] R2 upload error (non-fatal):', uploadErr.message);
        // Non-fatal: pembayaran tetap diproses meski upload gagal
      }
    }

    const updated = await db.$queryRawUnsafe<any[]>(`
      UPDATE payments SET
        metode_pembayaran = $1,
        jumlah_bayar = $2,
        status_pembayaran = 'lunas',
        tgl_pembayaran = NOW(),
        konfirmasi_pada = NOW(),
        dikonfirmasi_oleh = $5,
        bukti_pembayaran = COALESCE($6, bukti_pembayaran)
      WHERE order_id = $3 AND tenant_id = $4 RETURNING id
    `, metodeBayar, jumlahBayar, parseInt(order_id), tenantId, confirmingUserId, buktiUrl);

    if (updated.length === 0) {
      await db.$queryRawUnsafe(`
        INSERT INTO payments (tenant_id, order_id, metode_pembayaran, jumlah_bayar, status_pembayaran, tgl_pembayaran, konfirmasi_pada, dikonfirmasi_oleh, bukti_pembayaran)
        VALUES ($1, $2, $3, $4, 'lunas', NOW(), NOW(), $5, $6)
      `, tenantId, parseInt(order_id), metodeBayar, jumlahBayar, confirmingUserId, buktiUrl);
    }

    // Update order status to selesai and bump server_version for sync
    await db.$queryRawUnsafe(
      `UPDATE orders SET status = 'selesai', server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT), updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      parseInt(order_id), tenantId
    );

    // Return updated order so mobile can refresh the detail page
    const updatedOrder = await db.$queryRawUnsafe<any[]>(`
      SELECT o.*, c.nama as nama_pelanggan, c.no_hp,
             p.status_pembayaran, p.tgl_pembayaran, p.jumlah_bayar,
             p.metode_pembayaran as metode_bayar, p.konfirmasi_pada,
             p.bukti_pembayaran
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
      WHERE o.id = $1
    `, parseInt(order_id));

    res.json({
      status: 'success',
      message: 'Pembayaran berhasil dikonfirmasi.',
      data: updatedOrder.length > 0 ? updatedOrder[0] : null
    });
  } catch (err: any) {
    console.error('[PayOrder Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal proses pembayaran.' });
  }
};

// POST /api/v1/sync/delete-order
export const deleteOrder = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const role = req.user?.role || '';
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    // Accept id, order_id from body or query
    const idParam = req.body.id || req.body.order_id || req.query.id;
    const orderId = parseInt(idParam as string);
    if (!orderId) return res.status(400).json({ status: 'error', message: 'ID pesanan diperlukan.' });

    // Verify order belongs to tenant
    const orderRows = await db.$queryRawUnsafe<any[]>(
      `SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2`,
      orderId, tenantId
    );
    if (orderRows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });
    }

    // M-1: Admin → soft delete (status = 'dibatalkan') untuk mempertahankan audit trail.
    // Hard delete menghilangkan semua bukti transaksi — berbahaya untuk rekonsiliasi keuangan.
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    if (isAdmin) {
      // Soft delete: set status dibatalkan + tandai deleted_at
      await db.$queryRawUnsafe(
        `UPDATE orders SET status = 'dibatalkan', 
         server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT),
         updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        orderId, tenantId
      );
      // Batalkan pembayaran yang terkait
      await db.$queryRawUnsafe(
        `UPDATE payments SET status_pembayaran = 'dibatalkan' WHERE order_id = $1 AND tenant_id = $2`,
        orderId, tenantId
      );
      return res.json({ status: 'success', message: 'Pesanan berhasil dibatalkan dan diarsipkan.' });
    }

    // Non-admin: hanya bisa batalkan pesanan yang masih menunggu
    const order = orderRows[0];
    if (order.status !== 'menunggu_konfirmasi') {
      return res.status(400).json({ status: 'error', message: 'Pesanan yang sedang diproses tidak bisa dibatalkan.' });
    }

    await db.$queryRawUnsafe(
      `UPDATE orders SET status = 'dibatalkan', server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT), updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      orderId, tenantId
    );
    res.json({ status: 'success', message: 'Pesanan berhasil dibatalkan.' });
  } catch (err: any) {
    console.error('[DeleteOrder Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus pesanan.' });
  }
};

