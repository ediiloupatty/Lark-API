"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpaymuService = void 0;
const crypto_1 = __importDefault(require("crypto"));
class IpaymuService {
    static va = process.env.IPAYMU_VA || '';
    static apiKey = process.env.IPAYMU_API_KEY || '';
    static env = process.env.IPAYMU_ENV || 'sandbox';
    static getBaseUrl() {
        return this.env === 'production'
            ? 'https://my.ipaymu.com'
            : 'https://sandbox.ipaymu.com';
    }
    static generateSignature(body, method = 'POST') {
        const stringBody = JSON.stringify(body);
        // 1. Calculate SHA256 of the JSON body
        const bodyHash = crypto_1.default.createHash('sha256').update(stringBody).digest('hex').toLowerCase();
        // 2. Create String to Sign: method:va:bodyHash:apiKey
        const stringToSign = `${method}:${this.va}:${bodyHash}:${this.apiKey}`;
        // 3. Generate HMAC SHA256 signature
        const signature = crypto_1.default.createHmac('sha256', this.apiKey).update(stringToSign).digest('hex');
        // Timestamp format: YYYYMMDDHHMMSS
        const now = new Date();
        const timestamp = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');
        return { signature, timestamp };
    }
    static async createPayment(params) {
        const url = `${this.getBaseUrl()}/api/v2/payment`;
        // Map params to iPaymu's required format
        const requestBody = {
            product: params.product,
            qty: params.qty,
            price: params.price,
            returnUrl: params.returnUrl,
            cancelUrl: params.cancelUrl,
            notifyUrl: params.notifyUrl,
            referenceId: params.referenceId || `TRX-${Date.now()}`,
            buyerName: params.buyerName,
            buyerEmail: params.buyerEmail,
            buyerPhone: params.buyerPhone,
        };
        const { signature, timestamp } = this.generateSignature(requestBody);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'signature': signature,
                    'va': this.va,
                    'timestamp': timestamp,
                },
                body: JSON.stringify(requestBody),
            });
            const responseData = await response.json();
            if (!response.ok || responseData.Status !== 200) {
                console.error('iPaymu Error Response:', responseData);
                throw new Error(responseData.Message || 'Failed to generate payment link');
            }
            return responseData.Data; // Contains SessionID, Url, etc.
        }
        catch (error) {
            console.error('iPaymu Service Error:', error);
            throw error;
        }
    }
}
exports.IpaymuService = IpaymuService;
