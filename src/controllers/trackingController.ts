import { Request, Response } from 'express';
import { db as prisma } from '../config/db';

function maskName(name: string): string {
  if (!name) return 'Customer';
  const parts = name.split(' ');
  const firstName = parts[0];
  if (firstName.length <= 2) return firstName + '***';
  return firstName.substring(0, 2) + '***';
}

function maskPhone(phone: string): string {
  if (!phone) return '0812-****-****';
  // Keep first 4 and last 3, mask the rest
  if (phone.length < 8) return phone;
  const start = phone.substring(0, 4);
  const end = phone.substring(phone.length - 3);
  return `${start}-****-${end}`;
}

export class TrackingController {
  
  // GET /api/v1/public/track/:resi
  static async getTracking(req: Request, res: Response) {
    try {
      const { resi } = req.params;
      
      const order: any = await prisma.orders.findUnique({
        where: { tracking_code: resi as string },
        include: {
          tenants: { select: { name: true } },
          outlets: { select: { nama: true } },
          customers: { select: { nama: true, no_hp: true } },
          order_details: {
            include: { services: { select: { nama_layanan: true } } }
          },
          payments: {
            orderBy: { created_at: 'desc' },
            take: 1
          }
        }
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Resi tidak ditemukan.' });
      }

      // Masking
      const customerName = maskName(order.customers?.nama || '');
      const customerPhone = maskPhone(order.customers?.no_hp || '');

      // BUG-24 FIX: Remove total_harga from public response — financial data leak
      // Anyone with a tracking code could see order amounts without authentication
      return res.status(200).json({
        success: true,
        data: {
          tracking_code: order.tracking_code,
          status: order.status,
          tgl_order: order.tgl_order,
          estimasi_tanggal: order.estimasi_tanggal,
          metode_antar: order.metode_antar,
          tenant: order.tenants?.name,
          outlet: order.outlets?.nama,
          customer: {
            nama: customerName,
            no_hp: customerPhone
          },
          items: (order as any).order_details.map((item: any) => ({
            layanan: item.services?.nama_layanan || item.jenis_pakaian,
            jumlah: item.jumlah,
            berat: item.berat,
          })),
          payment_status: (order as any).payments.length > 0 ? (order as any).payments[0].status_pembayaran : 'pending'
        }
      });

    } catch (error: any) {
      console.error('Error fetching tracking:', error);
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
    }
  }

  // POST /api/v1/public/track/verify
  static async verifyTracking(req: Request, res: Response) {
    try {
      const { resi, phone } = req.body;
      
      if (!resi || !phone) {
        return res.status(400).json({ success: false, message: 'Resi dan nomor telepon wajib diisi.' });
      }

      const order = await prisma.orders.findUnique({
        where: { tracking_code: resi },
        include: {
          tenants: { select: { id: true, name: true } },
          customers: { select: { id: true, nama: true, no_hp: true } },
          order_details: {
            include: { services: { select: { nama_layanan: true } } }
          },
          payments: { orderBy: { created_at: 'desc' }, take: 1 }
        }
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Resi tidak ditemukan.' });
      }

      // Format the input phone simply (remove non digits except + if we want, but let's just do a simple endsWith/includes check)
      const inputPhone = phone.replace(/\D/g, '');
      const dbPhone = order.customers?.no_hp?.replace(/\D/g, '') || '';
      
      // SECURITY FIX: Require minimum 10 digits for flexible matching (Indonesian phone = 10-13 digits).
      // Previously 8 digits was enough, which only requires guessing 2-5 digits (brute-forceable).
      // With 10 digits minimum, attacker needs near-full phone number to pass verification.
      const isMatch = dbPhone === inputPhone || (inputPhone.length >= 10 && dbPhone.endsWith(inputPhone));
      
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Nomor WhatsApp tidak cocok dengan resi.' });
      }

      // BUG-23 FIX: Limit history query — this is a PUBLIC endpoint
      // Without limit, a customer with 10k+ orders could cause memory explosion
      const history: any[] = await prisma.orders.findMany({
        where: {
          tenant_id: order.tenant_id,
          customer_id: order.customer_id
        },
        orderBy: { tgl_order: 'desc' },
        take: 20, // Limit to 20 most recent orders
        include: {
          order_details: {
            include: { services: { select: { nama_layanan: true } } }
          },
          payments: { orderBy: { created_at: 'desc' }, take: 1 }
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          current_order: {
            tracking_code: order.tracking_code,
            status: order.status,
            tgl_order: order.tgl_order,
            estimasi_tanggal: order.estimasi_tanggal,
            total_harga: order.total_harga,
            tenant: (order as any).tenants?.name,
            customer: {
              nama: (order as any).customers?.nama,
              no_hp: (order as any).customers?.no_hp
            },
            items: (order as any).order_details.map((item: any) => ({
              layanan: item.services?.nama_layanan || item.jenis_pakaian,
              jumlah: item.jumlah,
              berat: item.berat,
              subtotal: item.subtotal
            })),
            payment_status: (order as any).payments.length > 0 ? (order as any).payments[0].status_pembayaran : 'pending'
          },
          history: history.map(h => ({
            id: h.id,
            tracking_code: h.tracking_code,
            tgl_order: h.tgl_order,
            status: h.status,
            total_harga: h.total_harga,
            items: h.order_details.map((item: any) => ({
              layanan: item.services?.nama_layanan || item.jenis_pakaian,
              jumlah: item.jumlah,
              berat: item.berat
            })),
            payment_status: h.payments.length > 0 ? h.payments[0].status_pembayaran : 'pending'
          }))
        }
      });
      
    } catch (error: any) {
      console.error('Error verifying tracking:', error);
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
    }
  }
}
