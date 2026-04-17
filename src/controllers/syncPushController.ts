import { Request, Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

function extractOrders(input: any): any[] {
  const paths = [
    ['orders'], ['pending_orders'], ['data', 'orders'], ['payload', 'orders'],
    ['sync_data', 'orders'], ['order'], ['data', 'order']
  ];
  
  for (const path of paths) {
    let current = input;
    for (const segment of path) {
      if (current && typeof current === 'object' && segment in current) {
        current = current[segment];
      } else {
        current = null;
        break;
      }
    }
    if (Array.isArray(current) && current.length > 0) return current;
    if (current && typeof current === 'object') return [current];
  }
  
  if (Array.isArray(input)) return input;
  return [];
}

export const pushChanges = async (req: AuthRequest, res: Response) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) {
    return res.status(403).json({ status: 'error', message: 'Fungsi ini khusus untuk karyawan atau admin laundry.' });
  }

  const rawOrders = extractOrders(req.body);
  if (rawOrders.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Format payload salah. Harus ada data pesanan yang valid.' });
  }
  // Fix B-7: Limit batch size agar tidak timeout dan kehilangan data
  if (rawOrders.length > 50) {
    return res.status(400).json({ status: 'error', message: 'Maksimal 50 pesanan per sinkronisasi. Bagi menjadi beberapa batch.' });
  }

  try {
    let successCount = 0;
    const results: any[] = [];

    // Menggunakan Prisma Transaction untuk memproses pesanan
    await db.$transaction(async (tx: any) => {
       for (const o of rawOrders) {
         const offlineId = o.offline_id || o.client_id || o.tracking_code || 'unknown';
         const clientId = o.client_id || '';
         let customerId = o.customer_id || o.customer_server_id || null;
         const customerName = o.customer_nama || o.nama_pelanggan || o.customer_name || 'Pelanggan Walk-in';
         const customerPhone = o.customer_phone || o.no_hp || o.phone || '';
         const orderStatus = o.status || 'diproses';
         const metodeAntar = o.metode_antar || 'antar_sendiri';
         const paymentStatus = (o.payment_status?.toLowerCase() === 'lunas' || o.status_pembayaran?.toLowerCase() === 'paid') ? 'lunas' : 'pending';
         const paymentMethod = o.payment_method || o.metode_bayar || 'cash';
         const outletId = o.outlet_id || req.user?.outlet_id;
         const totalAmount = parseFloat(o.total_amount || o.total_harga || 0);
         const items = Array.isArray(o.items) ? o.items : (Array.isArray(o.order_details) ? o.order_details : []);

         // 1. Handle Customer
         if (!customerId) {
           if (customerPhone) {
             const existCust = await tx.customers.findFirst({
                where: { tenant_id: tenantId, no_hp: customerPhone, deleted_at: null }
             });
             if (existCust) {
               customerId = existCust.id;
             } else {
               const newCust = await tx.customers.create({
                 data: { tenant_id: tenantId, nama: customerName, no_hp: customerPhone }
               });
               customerId = newCust.id;
             }
           } else {
             const walkIn = await tx.customers.findFirst({
               where: { tenant_id: tenantId, nama: 'Pelanggan Walk-in', deleted_at: null }
             });
             if (walkIn) {
               customerId = walkIn.id;
             } else {
               const newWalk = await tx.customers.create({
                 data: { tenant_id: tenantId, nama: 'Pelanggan Walk-in', no_hp: '' }
               });
               customerId = newWalk.id;
             }
           }
         }

         // Check duplicate
         if (clientId) {
           const existOrder = await tx.orders.findFirst({
             where: { tenant_id: tenantId, client_id: clientId }
           });
           if (existOrder) {
             results.push({ offline_id: offlineId, official_order_number: existOrder.tracking_code, status: 'already_synced' });
             successCount++;
             continue;
           }
         }

         const dte = new Date().toISOString().substring(0, 10).replace(/-/g, '');
         const orderNumber = `INV-${tenantId}-${dte}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

         // Build relation payload for Order creation with Prisma
         const orderDetailsPayload = items.map((item: any) => ({
             service_id: item.service_id || item.layanan_id || null,
             jumlah: item.jumlah || item.qty ? parseInt(item.jumlah || item.qty) : null,
             berat: item.berat ? parseFloat(item.berat) : null,
             harga: parseFloat(item.price || item.harga || 0),
             subtotal: parseFloat(item.subtotal || 0)
         }));

         // Ensure the enums match the schema
         let safeMethod: any = paymentMethod === 'cash' ? 'cash' : 'transfer'; // simplified mapping 

         // Insert target
         const newOrder = await tx.orders.create({
            data: {
               tenant_id: tenantId,
               customer_id: customerId,
               tracking_code: orderNumber,
               total_harga: totalAmount,
               metode_antar: metodeAntar === 'jemput' ? 'jemput' : 'antar_sendiri',
               outlet_id: outletId,
               user_id: req.user?.user_id,
               client_id: clientId || null,
               payments: {
                  create: [{
                    tenant_id: tenantId,
                    metode_pembayaran: safeMethod,
                    jumlah_bayar: totalAmount,
                    outlet_id: outletId
                  }]
               },
               order_details: {
                  create: orderDetailsPayload
               }
            }
         });

         results.push({ offline_id: offlineId, official_order_number: orderNumber, status: 'synced_success' });
         successCount++;
       }
     }, { timeout: 15000 }); // Longer timeout setting to handle massive sync payloads.

     // Trigger Push Notification & Simpan Notif ke Inbox untuk order yang baru masuk
     try {
       const { sendPushToAdmins, saveNotification } = require('../services/firebaseService');
       const creatorName = req.user?.nama || req.user?.username || 'Karyawan';
       
       for (const result of results) {
         if (result.status === 'synced_success') {
           const trackingCode = result.official_order_number;
           const pushTitle = '🧺 Pesanan Baru Masuk!';
           const pushBody = `${creatorName} telah menyinkronkan pesanan #${trackingCode}`;
           
           // Kirim push
           sendPushToAdmins({
             tenantId: tenantId,
             title: pushTitle,
             body: pushBody,
             data: { type: 'new_order', tracking_code: trackingCode },
           }).catch(() => {});

           db.users.findMany({
             where: { tenant_id: tenantId, role: { in: ['admin', 'super_admin', 'owner'] as any }, is_active: true, deleted_at: null },
             select: { id: true },
           }).then((admins: any) => {
             for (const admin of admins) {
               saveNotification({
                 tenantId: tenantId,
                 userId: admin.id,
                 tipe: 'new_order',
                 pesan: pushBody,
               }).catch(() => {});
             }
           }).catch(() => {});
         }
       }
     } catch (notifErr) {
       console.error('[Sync Push] Gagal kirim notif:', notifErr);
     }

     res.json({ status: 'success', message: `${successCount} Pesanan Offline berhasil disinkronisasi ke server pusat.`, data: { synced_data: results }});

  } catch (err: any) {
    console.error('[Sync Push]', err);
    res.status(500).json({ status: 'error', message: 'Gagal melakukan sinkronisasi.', error: err.message });
  }
};
