import { Request, Response } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

/**
 * Media Proxy Controller
 * 
 * Proxies images from Cloudflare R2 through our own API domain
 * to bypass ISP SSL interception (e.g., Telkomsel's "internetbaik").
 * 
 * Uses S3 API (private) to fetch from R2, NOT the public URL.
 * This ensures the proxy works even when R2 public URL is blocked.
 * 
 * Route: GET /api/v1/public/media/*path
 */

const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT          = process.env.R2_ENDPOINT || '';
const R2_BUCKET            = process.env.R2_BUCKET || 'lark-uploads';

let s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3;
}

export const proxyMedia = async (req: Request, res: Response) => {
  try {
    // Extract the full path after /media/
    // Express 5 *path wildcard returns an array of path segments
    const rawPath = req.params.path || req.params[0];
    const mediaPath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
    if (!mediaPath) {
      return res.status(400).json({ status: 'error', message: 'Path media tidak valid.' });
    }

    // Sanitize: prevent directory traversal
    if (mediaPath.includes('..')) {
      return res.status(400).json({ status: 'error', message: 'Path tidak valid.' });
    }

    // BUG-29 FIX: Only allow access to known upload prefixes
    // Without this, an attacker could access any object in the R2 bucket
    const ALLOWED_PREFIXES = ['payments/', 'expenses/'];
    if (!ALLOWED_PREFIXES.some(prefix => mediaPath.startsWith(prefix))) {
      return res.status(403).json({ status: 'error', message: 'Akses media tidak diizinkan.' });
    }

    if (!R2_ACCESS_KEY_ID || !R2_ENDPOINT) {
      return res.status(503).json({ status: 'error', message: 'Storage tidak dikonfigurasi.' });
    }

    // Fetch directly from R2 via S3 API (private, not public URL)
    // Strip leading slash if present (Express 5 *path may include it)
    const key = mediaPath.replace(/^\/+/, '');
    console.log(`[MediaProxy] Requested key: "${key}" (raw param: "${mediaPath}")`);

    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });

    const r2Response = await client.send(command);

    if (!r2Response.Body) {
      return res.status(404).json({ status: 'error', message: 'Media tidak ditemukan.' });
    }

    // Set response headers
    const contentType = r2Response.ContentType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year cache
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (r2Response.ContentLength) {
      res.setHeader('Content-Length', r2Response.ContentLength);
    }

    // Stream the S3 response body to the client
    if (r2Response.Body instanceof Readable) {
      r2Response.Body.pipe(res);
    } else {
      // Fallback: convert to buffer
      const chunks: Uint8Array[] = [];
      // @ts-ignore - Body can be AsyncIterable
      for await (const chunk of r2Response.Body) {
        chunks.push(chunk);
      }
      res.send(Buffer.concat(chunks));
    }
  } catch (err: any) {
    console.error('[MediaProxy] Error:', err.name, err.message);
    if (!res.headersSent) {
      const status = err.name === 'NoSuchKey' ? 404 : 502;
      const message = err.name === 'NoSuchKey' ? 'Media tidak ditemukan.' : 'Gagal memuat media.';
      res.status(status).json({ status: 'error', message });
    }
  }
};
