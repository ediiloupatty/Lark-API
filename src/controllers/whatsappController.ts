import { Request, Response } from 'express';
import { WhatsAppService } from '../services/whatsappService';

export const getStatus = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenant_id;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Tenant ID missing.' });
    }

    const { status, qrCode } = WhatsAppService.getStatus(tenantId);
    const stats = WhatsAppService.getStats(tenantId);
    
    return res.json({ success: true, status, qrCode, stats });
  } catch (error: any) {
    console.error('Error in getStatus:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

export const generateQr = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenant_id;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Tenant ID missing.' });
    }

    // Initialize akan membuat instance jika belum ada
    await WhatsAppService.initialize(tenantId);
    
    return res.json({ success: true, message: 'WhatsApp Client initialization started.' });
  } catch (error: any) {
    console.error('Error in generateQr:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenant_id;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Tenant ID missing.' });
    }

    await WhatsAppService.logout(tenantId);
    
    return res.json({ success: true, message: 'WhatsApp Client logged out successfully.' });
  } catch (error: any) {
    console.error('Error in logout:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

export const sendManualMessage = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenant_id;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Tenant ID missing.' });
    }

    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'Phone and message are required.' });
    }

    // Call service to send message through queue
    await WhatsAppService.sendMessage(tenantId, phone, message);
    
    return res.json({ success: true, message: 'Pesan telah dimasukkan ke antrean pengiriman WhatsApp otomatis.' });
  } catch (error: any) {
    console.error('Error in sendManualMessage:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};
