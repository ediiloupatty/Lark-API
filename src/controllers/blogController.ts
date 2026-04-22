/**
 * blogController.ts — Public API for blog articles
 * 
 * Endpoints:
 * - GET /api/v1/public/blog          → list semua artikel (published, newest first)
 * - GET /api/v1/public/blog/:slug    → detail 1 artikel by slug
 * - POST /api/v1/public/blog/generate → trigger manual generate (admin only, via secret)
 */

import { Request, Response } from 'express';
import { pool } from '../config/db';
import { generateDailyBlog } from '../services/blogGeneratorService';

/**
 * GET /api/v1/public/blog
 * List semua published blog articles, terbaru di atas
 */
export async function listBlogArticles(req: Request, res: Response) {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, slug, title, excerpt, read_time, status, created_at
         FROM blog_articles
         WHERE status = 'published'
         ORDER BY created_at DESC
         LIMIT 50`
      );

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
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error('[Blog API] listBlogArticles error:', e.message);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil daftar artikel.' });
  }
}

/**
 * GET /api/v1/public/blog/:slug
 * Detail 1 artikel by slug
 */
export async function getBlogArticle(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    
    // Sanitize slug — hanya izinkan alphanumeric, dash, underscore
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      res.status(400).json({ status: 'error', message: 'Slug tidak valid.' });
      return;
    }

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, slug, title, excerpt, content, read_time, source_urls, created_at
         FROM blog_articles
         WHERE slug = $1 AND status = 'published'
         LIMIT 1`,
        [slug]
      );

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
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error('[Blog API] getBlogArticle error:', e.message);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil artikel.' });
  }
}

/**
 * POST /api/v1/public/blog/generate
 * Manual trigger generate — protected by simple secret header
 */
export async function triggerGenerate(req: Request, res: Response) {
  // Simple protection: require a secret header
  const secret = req.headers['x-blog-secret'];
  if (secret !== process.env.JWT_SECRET) {
    res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    return;
  }

  const result = await generateDailyBlog();
  
  if (result.success) {
    res.json({
      status: 'success',
      message: `Artikel berhasil di-generate: "${result.title}"`,
      articleId: result.articleId,
    });
  } else {
    res.status(500).json({
      status: 'error',
      message: `Gagal generate: ${result.error}`,
    });
  }
}
