/**
 * generateBlog.ts — Standalone CRON Script
 * 
 * Jalankan via CRON untuk generate 1 blog artikel per hari.
 * 
 * Usage:
 *   npx tsx src/scripts/generateBlog.ts
 * 
 * CRON (setiap hari jam 06:00 WIB):
 *   0 6 * * * cd /root/lark/backend-node && npx tsx src/scripts/generateBlog.ts >> logs/blog-cron.log 2>&1
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env sebelum import yang lain
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { generateDailyBlog } from '../services/blogGeneratorService';
import { pool } from '../config/db';

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[CRON] Blog Auto-Generate — ${timestamp}`);
  console.log(`${'='.repeat(60)}`);

  const result = await generateDailyBlog();

  if (result.success && result.articles) {
    result.articles.forEach((art: any, idx: number) => {
      console.log(`[CRON] ✅ Berhasil! Artikel ${idx + 1}: "${art.title}" (ID: ${art.id})`);
    });
  } else {
    console.error(`[CRON] ❌ Gagal: ${result.error}`);
  }

  // Tutup pool connection
  await pool.end();
  process.exit(result.success ? 0 : 1);
}

main().catch((e) => {
  console.error('[CRON] Fatal error:', e);
  process.exit(1);
});
