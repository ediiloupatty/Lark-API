import fs from 'fs';

const filePath = '/home/ediloupatty/edi/Project/project_kuliah/lark/backend-node/src/controllers/orderController.ts';
let code = fs.readFileSync(filePath, 'utf-8');

const replacement = `    // Start Transaction
    const result = await db.$transaction(async (tx) => {
      // Create Order
      const orderData: any = {
        tenant_id: tenantId,
        customer_id: parseInt(customer_id),
        status: 'diproses',
        metode_antar: metode_antar || 'antar_sendiri',
        catatan: catatan || '',
        tracking_code: trackingCode,
        estimasi_tanggal: new Date(estimasiTanggal),
        estimasi_waktu: estimasiWaktu,
        outlet_id: targetOutletId,
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
      const payStatus = (status_bayar === 'sekarang' && totalHarga > 0) ? 'lunas' : 'pending';
      const payAmount = (status_bayar === 'sekarang' && totalHarga > 0) ? totalHarga : 0;
      
      await tx.payments.create({
        data: {
          tenant_id: tenantId,
          order_id: orderId,
          metode_pembayaran: metode_bayar || 'cash',
          jumlah_bayar: payAmount,
          status_pembayaran: payStatus,
          outlet_id: targetOutletId
        }
      });

      return { orderId, totalHarga, trackingCode };
    });`;

// Find the block to replace using regex targeting start to end
const regex = /\/\/ Start Transaction[\s\S]*?return { orderId, totalHarga, trackingCode };\n    \}\);/m;
code = code.replace(regex, replacement);

fs.writeFileSync(filePath, code);
