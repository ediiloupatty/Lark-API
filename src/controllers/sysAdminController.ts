import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { db } from '../config/db';

export const getGlobalStats = async (req: AuthRequest, res: Response) => {
  try {
    // Pastikan ini adalah global master admin (role super_admin dan tidak terikat tenant)
    if (req.user?.role !== 'super_admin' || req.user?.tenant_id !== null) {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Master Admin.' });
    }

    const totalTenants = await db.tenants.count();
    
    // Aggregate total pesanan
    const totalOrders = await db.orders.count({ where: { deleted_at: null } as any });
    
    // Aggregate total pendapatan (orders selesai / lunas)
    const revenueAgg = await db.orders.aggregate({
      _sum: {
        total_harga: true,
      },
      where: {
        status: 'selesai',
        deleted_at: null as any
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        total_tenants: totalTenants,
        total_orders: totalOrders,
        total_revenue: (revenueAgg._sum as any).total_harga || 0
      }
    });
  } catch (error: any) {
    console.error('[SysAdminController] getGlobalStats error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil statistik global.' });
  }
};

export const getTenantsList = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin' || req.user?.tenant_id !== null) {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Master Admin.' });
    }

    const tenants = await db.tenants.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        subscription_plan: true,
        is_active: true,
        created_at: true,
        _count: {
          select: { orders: true, outlets: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: tenants
    });
  } catch (error: any) {
    console.error('[SysAdminController] getTenantsList error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil daftar tenant.' });
  }
};
