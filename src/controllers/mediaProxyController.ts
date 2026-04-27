import { Request, Response } from 'express';

/**
 * Media Proxy Controller
 * 
 * Proxies images from Cloudflare R2 through our own API domain
 * to bypass ISP SSL interception (e.g., Telkomsel's "internetbaik").
 * 
 * The R2 dev URL (pub-xxx.r2.dev) is blocked/intercepted by Indonesian ISPs,
 * causing ERR_CERT_AUTHORITY_INVALID in browsers. By proxying through
 * api.larklaundry.com (which has valid SSL), images load correctly.
 * 
 * Route: GET /api/v1/public/media/:path(*)
 */

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

export const proxyMedia = async (req: Request, res: Response) => {
  try {
    // Extract the full path after /media/
    const mediaPath = req.params[0];
    if (!mediaPath) {
      return res.status(400).json({ status: 'error', message: 'Path media tidak valid.' });
    }

    // Sanitize: prevent directory traversal
    if (mediaPath.includes('..') || mediaPath.includes('//')) {
      return res.status(400).json({ status: 'error', message: 'Path tidak valid.' });
    }

    if (!R2_PUBLIC_URL) {
      return res.status(503).json({ status: 'error', message: 'Storage tidak dikonfigurasi.' });
    }

    // Build the actual R2 URL
    const r2Url = R2_PUBLIC_URL.endsWith('/')
      ? `${R2_PUBLIC_URL}${mediaPath}`
      : `${R2_PUBLIC_URL}/${mediaPath}`;

    // Fetch from R2
    const r2Response = await fetch(r2Url);

    if (!r2Response.ok) {
      return res.status(r2Response.status).json({
        status: 'error',
        message: `Media tidak ditemukan (${r2Response.status}).`,
      });
    }

    // Forward content type and cache headers
    const contentType = r2Response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = r2Response.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year cache
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Stream the response body
    if (r2Response.body) {
      const reader = r2Response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      };
      await pump();
    } else {
      // Fallback: buffer entire response
      const buffer = Buffer.from(await r2Response.arrayBuffer());
      res.send(buffer);
    }
  } catch (err: any) {
    console.error('[MediaProxy] Error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ status: 'error', message: 'Gagal memuat media.' });
    }
  }
};
