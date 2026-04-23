"use strict";
/**
 * blogRoutes.ts — Public blog API routes
 *
 * All endpoints are public (no auth required) for SEO/sharing purposes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const blogController_1 = require("../controllers/blogController");
const router = (0, express_1.Router)();
// GET /api/v1/public/blog — list all published articles
router.get('/', blogController_1.listBlogArticles);
// POST /api/v1/public/blog/generate — manual trigger (protected by secret)
router.post('/generate', blogController_1.triggerGenerate);
// GET /api/v1/public/blog/:slug — get single article by slug
router.get('/:slug', blogController_1.getBlogArticle);
exports.default = router;
