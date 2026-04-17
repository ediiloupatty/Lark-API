import fs from 'fs';

const filePath = '/home/ediloupatty/edi/Project/project_kuliah/lark/backend-node/src/controllers/orderController.ts';
let code = fs.readFileSync(filePath, 'utf-8');

const replacement = `    const orders = await db.$queryRawUnsafe<any[]>(query, ...params);

    // Fetch order details mapping
    let itemsMap: Record<number, any[]> = {};
    if (orders.length > 0) {
      const orderIds = orders.map((o: any) => o.id);
      try {
        const items = await db.$queryRawUnsafe<any[]>(
          \`SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, pk.nama as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           LEFT JOIN paket_laundry pk ON s.paket_id = pk.id
           WHERE od.order_id = ANY($1::int[])\`,
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
        // Fallback in case paket_laundry does not exist
        const items = await db.$queryRawUnsafe<any[]>(
          \`SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg, NULL as paket_nama
           FROM order_details od
           JOIN services s ON od.service_id = s.id
           WHERE od.order_id = ANY($1::int[])\`,
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
    });`;

const regex = /    const orders = await db\.\$queryRawUnsafe<any\[\]>\(query, \.\.\.params\);\n\n    const formattedOrders = orders\.map\(o => \(\{\n[\s\S]*?    \}\)\);/m;
code = code.replace(regex, replacement);

fs.writeFileSync(filePath, code);
