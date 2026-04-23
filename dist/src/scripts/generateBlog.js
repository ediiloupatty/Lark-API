"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env sebelum import yang lain
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
const blogGeneratorService_1 = require("../services/blogGeneratorService");
const db_1 = require("../config/db");
async function main() {
    const timestamp = new Date().toISOString();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[CRON] Blog Auto-Generate — ${timestamp}`);
    console.log(`${'='.repeat(60)}`);
    const result = await (0, blogGeneratorService_1.generateDailyBlog)();
    if (result.success && result.articles) {
        result.articles.forEach((art, idx) => {
            console.log(`[CRON] ✅ Berhasil! Artikel ${idx + 1}: "${art.title}" (ID: ${art.id})`);
        });
    }
    else {
        console.error(`[CRON] ❌ Gagal: ${result.error}`);
    }
    // Tutup pool connection
    await db_1.pool.end();
    process.exit(result.success ? 0 : 1);
}
main().catch((e) => {
    console.error('[CRON] Fatal error:', e);
    process.exit(1);
});
