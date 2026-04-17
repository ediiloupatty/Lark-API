import fs from 'fs';

const filePath = '/home/ediloupatty/edi/Project/project_kuliah/lark/backend-node/src/controllers/orderController.ts';
let code = fs.readFileSync(filePath, 'utf-8');

// The replacement logic to handle ?id=
const replacement = `    const statusFilter = req.query.status as string || '';
    const search = req.query.search as string || '';
    const customerId = req.query.customer_id as string || '';
    const orderId = req.query.id as string || '';
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.max(1, parseInt(req.query.limit as string || '20'));
    const offset = (page - 1) * limit;

    let query = \`
      SELECT o.id, o.client_id, o.server_version, o.updated_at,
             o.tracking_code, o.tgl_order, o.tgl_diproses, o.tgl_siap, o.tgl_selesai,
             o.total_harga, o.status, o.metode_antar, 
             o.estimasi_tanggal, o.estimasi_waktu, o.catatan, o.paket_id, o.alamat_jemput,
             c.nama as nama_pelanggan, c.no_hp, c.alamat as alamat_pelanggan,
             p.status_pembayaran, p.tgl_pembayaran, p.konfirmasi_pada, p.jumlah_bayar, p.metode_pembayaran as metode_bayar,
             ot.nama as outlet_nama, ot.alamat as outlet_alamat, ot.phone as outlet_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
      LEFT JOIN outlets ot ON o.outlet_id = ot.id
      WHERE o.tenant_id = $1
    \`;
    
    // IF SINGLE ORDER REQUEST
    if (orderId) {
      query += \` AND o.id = $2\`;
      const orders = await db.$queryRawUnsafe<any[]>(query, tenantId, parseInt(orderId));
      if (orders.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });
      }
      
      const order = orders[0];
      let items: any[] = [];
      try {
        items = await db.$queryRawUnsafe<any[]>(
          \`SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, pk.nama_paket as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           LEFT JOIN paket_laundry pk ON s.paket_id = pk.id
           WHERE od.order_id = $1\`,
          order.id
        );
      } catch (e) {
        items = await db.$queryRawUnsafe<any[]>(
          \`SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, NULL as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           WHERE od.order_id = $1\`,
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

    const params: any[] = [tenantId];
    let pIdx = 2;`;

const regex = /    const statusFilter = req\.query\.status as string \|\| '';[\s\S]*?    let pIdx = 2;/m;
code = code.replace(regex, replacement);

fs.writeFileSync(filePath, code);
