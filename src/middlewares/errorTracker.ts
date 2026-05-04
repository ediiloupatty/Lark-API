/**
 * Lark Laundry — API Error Tracker Middleware
 *
 * Middleware yang mencatat setiap API response error (status >= 400)
 * ke dalam ring buffer in-memory untuk monitoring di Super Admin dashboard.
 *
 * Fitur:
 *   - Ring buffer (max 500 entries) → tidak membebani memory
 *   - Error rate counter per menit → deteksi spike
 *   - Breakdown per endpoint, platform, dan status code
 *   - Tidak menyimpan ke DB (lightweight) — hanya in-memory
 *
 * KEAMANAN:
 *   - Tidak menyimpan request body (bisa mengandung password/token)
 *   - Hanya menyimpan metadata: path, method, status, user_id, tenant_id, platform
 */

import { Request, Response, NextFunction } from 'express';

// ── Types ───────────────────────────────────────────────────────
export interface ErrorLogEntry {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  errorMessage: string;
  userId: number | null;
  tenantId: number | null;
  platform: string; // 'LarkMobile' | 'LarkWeb' | 'unknown'
  ip: string;
  userAgent: string;
}

export interface ErrorRateEntry {
  minute: string; // ISO string truncated to minute
  count: number;
}

export interface EndpointErrorStat {
  path: string;
  method: string;
  count: number;
  lastError: string;
  lastOccurred: string;
}

export interface ErrorStats {
  recentErrors: ErrorLogEntry[];
  errorRate: ErrorRateEntry[];
  totalErrors1h: number;
  totalErrors24h: number;
  topEndpoints: EndpointErrorStat[];
  byStatusCode: Record<string, number>;
  byPlatform: Record<string, number>;
}

// ── Ring Buffer ─────────────────────────────────────────────────
const MAX_ENTRIES = 500;
const errorBuffer: ErrorLogEntry[] = [];

// ── Error Rate Counters (per minute, last 60 minutes) ───────────
const MAX_RATE_ENTRIES = 1440; // 24 jam = 1440 menit
const errorRateMap = new Map<string, number>();

// ── Endpoint Error Counters ─────────────────────────────────────
const endpointErrorMap = new Map<string, EndpointErrorStat>();

// ── Status Code Counters ────────────────────────────────────────
const statusCodeMap = new Map<number, number>();

// ── Platform Counters ───────────────────────────────────────────
const platformMap = new Map<string, number>();

// ── 24h & 1h counters ───────────────────────────────────────────
let totalErrors1h = 0;
let totalErrors24h = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();

function resetCountersIfNeeded(): void {
  const now = Date.now();
  if (now - lastHourReset >= 3600_000) {
    totalErrors1h = 0;
    lastHourReset = now;
  }
  if (now - lastDayReset >= 86400_000) {
    totalErrors24h = 0;
    statusCodeMap.clear();
    platformMap.clear();
    endpointErrorMap.clear();
    errorRateMap.clear();
    lastDayReset = now;
  }
}

// ── Paths to exclude from error tracking ────────────────────────
// Health checks, favicon, etc. yang sering 404 tapi bukan masalah user
const EXCLUDED_PATHS = [
  '/favicon.ico',
  '/robots.txt',
  '/api/v1/health',
];

// ── Middleware ───────────────────────────────────────────────────
export function errorTrackerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Intercept response finish event
  const originalEnd = res.end;

  res.end = function (this: Response, ...args: any[]): Response {
    // Hanya track error (4xx, 5xx)
    if (res.statusCode >= 400 && !EXCLUDED_PATHS.includes(req.path)) {
      resetCountersIfNeeded();

      const platform = (req.headers['x-app-platform'] as string) || 'unknown';
      const user = (req as any).user;
      const minuteKey = new Date().toISOString().slice(0, 16); // "2026-05-05T06:41"

      // Coba extract error message dari response body
      let errorMessage = `HTTP ${res.statusCode}`;
      try {
        // Access the response body chunks if available
        const body = (res as any).__errorTrackerBody;
        if (body) {
          const parsed = JSON.parse(body);
          errorMessage = parsed.message || parsed.error || errorMessage;
        }
      } catch { /* ignore parse errors */ }

      const entry: ErrorLogEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        errorMessage,
        userId: user?.user_id || null,
        tenantId: user?.tenant_id || null,
        platform,
        ip: (req.ip || req.socket.remoteAddress || '').replace('::ffff:', ''),
        userAgent: ((req.headers['user-agent'] as string) || '').slice(0, 100),
      };

      // Push to ring buffer
      errorBuffer.push(entry);
      if (errorBuffer.length > MAX_ENTRIES) {
        errorBuffer.shift();
      }

      // Update rate counter
      errorRateMap.set(minuteKey, (errorRateMap.get(minuteKey) || 0) + 1);
      // Cleanup old rate entries
      if (errorRateMap.size > MAX_RATE_ENTRIES) {
        const keys = [...errorRateMap.keys()].sort();
        while (keys.length > MAX_RATE_ENTRIES) {
          errorRateMap.delete(keys.shift()!);
        }
      }

      // Update endpoint counter
      const endpointKey = `${req.method} ${req.path}`;
      const existing = endpointErrorMap.get(endpointKey);
      endpointErrorMap.set(endpointKey, {
        path: req.path,
        method: req.method,
        count: (existing?.count || 0) + 1,
        lastError: errorMessage,
        lastOccurred: entry.timestamp,
      });

      // Update status code counter
      statusCodeMap.set(res.statusCode, (statusCodeMap.get(res.statusCode) || 0) + 1);

      // Update platform counter
      platformMap.set(platform, (platformMap.get(platform) || 0) + 1);

      // Increment hourly/daily counters
      totalErrors1h++;
      totalErrors24h++;
    }

    return originalEnd.apply(this, args as any);
  } as any;

  // Intercept json() to capture error message for logging
  const originalJson = res.json;
  res.json = function (this: Response, body: any): Response {
    if (res.statusCode >= 400 && body) {
      try {
        (res as any).__errorTrackerBody = JSON.stringify(body);
      } catch { /* ignore */ }
    }
    return originalJson.call(this, body);
  } as any;

  next();
}

// ── Public API: Get Error Stats ─────────────────────────────────
export function getErrorStats(): ErrorStats {
  resetCountersIfNeeded();

  // Build error rate array (last 60 minutes)
  const now = new Date();
  const rateEntries: ErrorRateEntry[] = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60000);
    const key = d.toISOString().slice(0, 16);
    rateEntries.push({ minute: key, count: errorRateMap.get(key) || 0 });
  }

  // Top 10 endpoints by error count
  const topEndpoints = [...endpointErrorMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Status code breakdown
  const byStatusCode: Record<string, number> = {};
  statusCodeMap.forEach((count, code) => { byStatusCode[String(code)] = count; });

  // Platform breakdown
  const byPlatform: Record<string, number> = {};
  platformMap.forEach((count, platform) => { byPlatform[platform] = count; });

  return {
    recentErrors: errorBuffer.slice(-50).reverse(), // Last 50, newest first
    errorRate: rateEntries,
    totalErrors1h,
    totalErrors24h,
    topEndpoints,
    byStatusCode,
    byPlatform,
  };
}

// ── Get current error rate (for health monitor spike detection) ──
export function getCurrentErrorRate(): number {
  const minuteKey = new Date().toISOString().slice(0, 16);
  return errorRateMap.get(minuteKey) || 0;
}
