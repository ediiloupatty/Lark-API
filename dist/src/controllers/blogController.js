"use strict";
/**
 * blogController.ts — Public API for blog articles
 *
 * Endpoints:
 * - GET /api/v1/public/blog          → list semua artikel (published, newest first)
 * - GET /api/v1/public/blog/:slug    → detail 1 artikel by slug
 * - POST /api/v1/public/blog/generate → trigger manual generate (admin only, via secret)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBlogArticles = listBlogArticles;
exports.getBlogArticle = getBlogArticle;
exports.triggerGenerate = triggerGenerate;
const db_1 = require("../config/db");
const blogGeneratorService_1 = require("../services/blogGeneratorService");
/**
 * GET /api/v1/public/blog
 * List semua published blog articles, terbaru di atas
 */
async function listBlogArticles(req, res) {
    try {
        const client = await db_1.pool.connect();
        try {
            const result = await client.query(`SELECT id, slug, title, excerpt, read_time, status, created_at
         FROM blog_articles
         WHERE status = 'published'
         ORDER BY created_at DESC
         LIMIT 50`);
            res.json({
                status: 'success',
                data: result.rows.map(row => ({
                    id: row.id,
                    slug: row.slug,
                    title: row.title,
                    excerpt: row.excerpt,
                    readTime: row.read_time,
                    date: row.created_at,
                })),
            });
        }
        finally {
            client.release();
        }
    }
    catch (e) {
        console.error('[Blog API] listBlogArticles error:', e.message);
        res.status(500).json({ status: 'error', message: 'Gagal mengambil daftar artikel.' });
    }
}
/**
 * GET /api/v1/public/blog/:slug
 * Detail 1 artikel by slug
 */
async function getBlogArticle(req, res) {
    try {
        const slug = req.params.slug;
        // Sanitize slug — hanya izinkan alphanumeric, dash, underscore
        if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
            res.status(400).json({ status: 'error', message: 'Slug tidak valid.' });
            return;
        }
        const client = await db_1.pool.connect();
        try {
            const result = await client.query(`SELECT id, slug, title, excerpt, content, read_time, source_urls, created_at
         FROM blog_articles
         WHERE slug = $1 AND status = 'published'
         LIMIT 1`, [slug]);
            if (result.rows.length === 0) {
                res.status(404).json({ status: 'error', message: 'Artikel tidak ditemukan.' });
                return;
            }
            const row = result.rows[0];
            res.json({
                status: 'success',
                data: {
                    id: row.id,
                    slug: row.slug,
                    title: row.title,
                    excerpt: row.excerpt,
                    content: row.content,
                    readTime: row.read_time,
                    sourceUrls: row.source_urls,
                    date: row.created_at,
                },
            });
        }
        finally {
            client.release();
        }
    }
    catch (e) {
        console.error('[Blog API] getBlogArticle error:', e.message);
        res.status(500).json({ status: 'error', message: 'Gagal mengambil artikel.' });
    }
}
/**
 * POST /api/v1/public/blog/generate
 * Manual trigger generate — protected by simple secret header
 */
async function triggerGenerate(req, res) {
    // Simple protection: require a secret header
    const secret = req.headers['x-blog-secret'];
    if (secret !== process.env.JWT_SECRET) {
        res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
        return;
    }
    const result = await (0, blogGeneratorService_1.generateDailyBlog)();
    if (result.success) {
        res.json({
            status: 'success',
            message: `Artikel berhasil di-generate: ${result.articles?.length} artikel.`,
            articles: result.articles,
        });
    }
    else {
        res.status(500).json({
            status: 'error',
            message: `Gagal generate: ${result.error}`,
        });
    }
}
