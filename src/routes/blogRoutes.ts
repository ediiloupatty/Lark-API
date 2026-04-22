/**
 * blogRoutes.ts — Public blog API routes
 * 
 * All endpoints are public (no auth required) for SEO/sharing purposes.
 */

import { Router } from 'express';
import { listBlogArticles, getBlogArticle, triggerGenerate } from '../controllers/blogController';

const router = Router();

// GET /api/v1/public/blog — list all published articles
router.get('/', listBlogArticles);

// POST /api/v1/public/blog/generate — manual trigger (protected by secret)
router.post('/generate', triggerGenerate);

// GET /api/v1/public/blog/:slug — get single article by slug
router.get('/:slug', getBlogArticle);

export default router;
