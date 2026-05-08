interface MayarInvoiceItem {
  quantity: number;
  rate: number;
  description: string;
}

interface MayarInvoiceParams {
  name: string;
  email: string;
  mobile: string;
  redirectUrl: string;
  description: string;
  expiredAt: string;
  items: MayarInvoiceItem[];
  extraData?: { noCustomer: string; idProd: string };
}

export class MayarService {
  private static apiKey = process.env.MAYAR_API_KEY || '';
  private static baseUrl = 'https://api.mayar.id/hl/v1';

  static async createInvoice(params: MayarInvoiceParams) {
    const response = await fetch(`${this.baseUrl}/invoice/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok || data.statusCode !== 200) {
      console.error('[Mayar] Error response:', data);
      throw new Error(data.messages || 'Gagal membuat invoice Mayar');
    }

    return data.data as { id: string; transactionId: string; link: string; expiredAt: number };
  }
}
