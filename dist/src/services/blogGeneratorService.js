"use strict";
/**
 * blogGeneratorService.ts
 *
 * Service utama untuk auto-generate blog articles:
 * 1. Fetch RSS feeds dari beberapa sumber berita
 * 2. Filter berita terkait laundry/bisnis/UMKM
 * 3. Gabungkan 3-5 berita → kirim ke Gemini AI
 * 4. Gemini rewrite menjadi 1 artikel blog unik
 * 5. Simpan ke database PostgreSQL
 *
 * Biaya: Rp 0 (Gemini free tier)
 * Beban VPS: Minimal (~10 detik per generate)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDailyBlog = generateDailyBlog;
const db_1 = require("../config/db");
// ── RSS Feed Sources ──────────────────────────────────────────────────────────
const RSS_FEEDS = [
    'https://www.antaranews.com/rss/ekonomi-bisnis.xml',
    'https://www.cnnindonesia.com/ekonomi/rss',
    'https://www.suara.com/rss/bisnis',
    'https://www.cnbcindonesia.com/news/rss',
    'https://www.liputan6.com/rss',
    'https://sindikasi.okezone.com/index.php/rss/0/RSS2.0'
];
// Keywords untuk filter berita terkait laundry/bisnis/viral/lucu
const KEYWORDS = [
    'laundry', 'binatu', 'cuci', 'pakaian',
    'umkm', 'usaha kecil', 'bisnis', 'wirausaha',
    'franchise', 'waralaba', 'startup', 'digital',
    'pelaku usaha', 'pengusaha', 'ekonomi kreatif',
    'operasional', 'manajemen', 'produktivitas',
    'viral', 'lucu', 'unik', 'sejarah', 'nostalgia', 'kisah sukses'
];
// Kategori yang valid untuk blog Lark Laundry
const VALID_CATEGORIES = [
    'tips-operasional',
    'panduan-pemula',
    'keuangan',
    'teknologi',
    'inspirasi',
    'industri',
];
// Fallback: deteksi kategori dari judul/konten jika Qwen tidak assign
const CATEGORY_KEYWORDS = {
    'tips-operasional': ['efisiensi', 'efisien', 'optimasi', 'produktivitas', 'operasional', 'hemat', 'energi', 'workflow'],
    'panduan-pemula': ['pemula', 'memulai', 'dari nol', 'panduan', 'langkah', 'cara'],
    'keuangan': ['biaya', 'hitung', 'untung', 'keuangan', 'modal', 'harga', 'tarif', 'pricing'],
    'teknologi': ['digital', 'aplikasi', 'teknologi', 'otomasi', 'transformasi', 'software', 'online'],
    'inspirasi': ['sukses', 'kisah', 'motivasi', 'inspirasi', 'viral', 'tren', 'nostalgia'],
    'industri': ['industri', 'regulasi', 'pasar', 'persaingan', 'ekonomi', 'kebijakan'],
};
function detectCategoryFallback(text) {
    const lower = text.toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw)))
            return cat;
    }
    return 'bisnis';
}
// ── RSS Parser (lightweight, no external dependency) ──────────────────────────
function parseRssXml(xml) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];
        const title = extractTag(itemXml, 'title');
        const description = extractTag(itemXml, 'description');
        const link = extractTag(itemXml, 'link');
        if (title && link) {
            items.push({
                title: cleanHtml(title),
                description: cleanHtml(description || ''),
                link: link.trim(),
            });
        }
    }
    return items;
}
function extractTag(xml, tag) {
    // Handle CDATA
    const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
    const cdataMatch = cdataRegex.exec(xml);
    if (cdataMatch)
        return cdataMatch[1].trim();
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = regex.exec(xml);
    return match ? match[1].trim() : '';
}
function cleanHtml(text) {
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}
// ── Fetch RSS Feeds ───────────────────────────────────────────────────────────
async function fetchRssFeeds() {
    const allItems = [];
    for (const feedUrl of RSS_FEEDS) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(feedUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'LarkLaundry-BlogBot/1.0' },
            });
            clearTimeout(timeout);
            if (!res.ok) {
                console.warn(`[BlogGen] RSS fetch gagal: ${feedUrl} (${res.status})`);
                continue;
            }
            const xml = await res.text();
            const items = parseRssXml(xml);
            allItems.push(...items);
            console.log(`[BlogGen] ✅ ${items.length} items dari ${feedUrl}`);
        }
        catch (e) {
            console.warn(`[BlogGen] RSS error ${feedUrl}: ${e.message}`);
        }
    }
    return allItems;
}
// ── Filter by Keywords ────────────────────────────────────────────────────────
function filterRelevantNews(items) {
    return items.filter(item => {
        const text = `${item.title} ${item.description}`.toLowerCase();
        return KEYWORDS.some(kw => text.includes(kw));
    });
}
// ── Qwen AI via DashScope (OpenAI-Compatible) ────────────────────────────────
const QWEN_MODELS = [
    'qwen-flash-2025-07-28',
    'qwen3.5-flash',
    'qwen3-coder-flash',
];
const DASHSCOPE_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
async function callQwen(prompt) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey)
        throw new Error('DASHSCOPE_API_KEY tidak ditemukan di .env');
    for (const model of QWEN_MODELS) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[BlogGen] 🤖 Trying ${model} (attempt ${attempt}/3)...`);
                const res = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            {
                                role: 'system',
                                content: 'Kamu adalah penulis blog profesional untuk Lark Laundry, platform manajemen bisnis laundry di Indonesia. Tulis dalam Bahasa Indonesia yang profesional dan mudah dipahami.',
                            },
                            { role: 'user', content: prompt },
                        ],
                        temperature: 0.7,
                        max_tokens: 4096,
                    }),
                });
                if (res.status === 429) {
                    console.warn(`[BlogGen] ⏳ Rate limited (${model}), waiting 10s...`);
                    await new Promise(r => setTimeout(r, 10000));
                    continue;
                }
                if (!res.ok) {
                    const errText = await res.text();
                    console.warn(`[BlogGen] ⚠️ ${model} error ${res.status}: ${errText.slice(0, 200)}`);
                    break; // Try next model
                }
                const json = await res.json();
                const text = json?.choices?.[0]?.message?.content;
                if (!text)
                    throw new Error('Qwen response kosong');
                console.log(`[BlogGen] ✅ ${model} berhasil!`);
                return text;
            }
            catch (e) {
                if (attempt === 3)
                    console.warn(`[BlogGen] ❌ ${model} gagal setelah 3 percobaan: ${e.message}`);
            }
        }
    }
    throw new Error('Semua model Qwen gagal. Coba lagi nanti.');
}
// ── Generate Article ──────────────────────────────────────────────────────────
function createSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 100)
        + '-' + Date.now().toString(36);
}
async function generateArticle(newsItems, previousTopics = '') {
    const newsContext = newsItems
        .map((n, i) => `Berita ${i + 1}: "${n.title}"\n${n.description}`)
        .join('\n\n');
    const prompt = `Kamu adalah penulis blog profesional untuk Lark Laundry, platform manajemen bisnis laundry di Indonesia.

Dari berita-berita berikut, buatkan 1 artikel blog UNIK dalam Bahasa Indonesia yang relevan untuk pelaku bisnis laundry/UMKM. Jika berita tidak terkait laundry, jadikan itu sebagai studi kasus, cerita lucu, tren viral, inspirasi nostalgia, atau pelajaran bisnis, TAPI selalu hubungkan kembali (bridge) ke operasional bisnis laundry agar relevan dan tidak membingungkan CEO atau pembaca kami.

Berita Sumber:
${newsContext}

${previousTopics ? `TOPIK YANG SUDAH DIBAHAS (WAJIB PILIH TOPIK YANG BERBEDA TOTAL, BUKAN VARIASI DARI TOPIK INI):\n${previousTopics}\nPilih sudut pandang, industri terkait, atau isu yang BENAR-BENAR BERBEDA dari topik di atas.\n\n` : ''}

ATURAN KETAT:
1. JANGAN copy-paste berita. Tulis ulang dengan sudut pandang baru yang relevan untuk pemilik bisnis laundry.
2. Gunakan gaya bahasa yang profesional, menarik, santai, tapi mudah dipahami.
3. Sertakan tips praktis yang bisa diterapkan oleh pemilik laundry.
4. Hubungkan dengan konteks bisnis laundry di Indonesia.
5. DILARANG KERAS menggunakan karakter markdown: **, *, —, --, ##, ###. Tulis teks biasa tanpa simbol-simbol tersebut.
6. Untuk penekanan teks, gunakan tag HTML <strong> saja, BUKAN tanda bintang (**).
7. Untuk dash/strip, gunakan tanda hubung biasa (-) bukan em-dash (—).

FORMAT OUTPUT (HARUS PERSIS):
---TITLE---
[Judul artikel yang menarik, max 80 karakter, TANPA tanda **, *, atau —]
---EXCERPT---
[Ringkasan singkat 1-2 kalimat, max 160 karakter]
---CATEGORY---
[Pilih SATU kategori paling relevan dari daftar berikut: tips-operasional, panduan-pemula, keuangan, teknologi, inspirasi, industri]
---READTIME---
[estimasi waktu baca, contoh: "5 min"]
---CONTENT---
[Konten artikel dalam format HTML murni. Gunakan tag: <h2>, <h3>, <p>, <ul>, <li>, <strong>. JANGAN gunakan <h1>. JANGAN gunakan markdown (**, *, ##). Panjang minimal 800 kata.]`;
    const raw = await callQwen(prompt);
    // Log raw response for debugging
    console.log(`[BlogGen] 📄 Raw response (first 300 chars): ${raw.slice(0, 300)}`);
    // Clean up any markdown wrapper Qwen might add
    let cleaned = raw
        .replace(/^```[\s\S]*?\n/, '') // Remove opening ```markdown or ```
        .replace(/\n```\s*$/, '') // Remove closing ```
        .trim();
    // Parse response with tolerant regex (handle extra whitespace, dashes, newlines)
    const titleMatch = cleaned.match(/---\s*TITLE\s*---\s*([\s\S]*?)---\s*EXCERPT\s*---/i);
    const excerptMatch = cleaned.match(/---\s*EXCERPT\s*---\s*([\s\S]*?)---\s*CATEGORY\s*---/i);
    const categoryMatch = cleaned.match(/---\s*CATEGORY\s*---\s*([\s\S]*?)---\s*READTIME\s*---/i);
    const readTimeMatch = cleaned.match(/---\s*READTIME\s*---\s*([\s\S]*?)---\s*CONTENT\s*---/i);
    const contentMatch = cleaned.match(/---\s*CONTENT\s*---\s*([\s\S]*)/i);
    // Fallback: jika format baru (dengan CATEGORY) gagal, coba format lama (tanpa CATEGORY)
    const excerptFallback = !excerptMatch ? cleaned.match(/---\s*EXCERPT\s*---\s*([\s\S]*?)---\s*READTIME\s*---/i) : null;
    let title = titleMatch?.[1]?.trim().replace(/^["']+|["']+$/g, '') || '';
    let excerpt = (excerptMatch || excerptFallback)?.[1]?.trim().replace(/^["']+|["']+$/g, '') || '';
    const rawCategory = categoryMatch?.[1]?.trim().toLowerCase().replace(/^["']+|["']+$/g, '') || '';
    const readTime = readTimeMatch?.[1]?.trim() || '5 min';
    let content = contentMatch?.[1]?.trim() || '';
    // Validasi category: harus salah satu dari VALID_CATEGORIES, fallback ke deteksi keyword
    let category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : '';
    if (!category) {
        category = detectCategoryFallback(`${title} ${excerpt} ${content.slice(0, 500)}`);
        console.log(`[BlogGen] 🏷️ Category auto-detected: "${category}" (Qwen returned: "${rawCategory}")`);
    }
    else {
        console.log(`[BlogGen] 🏷️ Category from Qwen: "${category}"`);
    }
    // Fallback: if delimiter parsing failed, try line-based extraction
    if (!title || !content) {
        console.warn('[BlogGen] ⚠️ Delimiter parsing failed, trying line-based extraction...');
        const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
        // First non-empty line that's not a delimiter is likely the title
        if (!title) {
            const titleLine = lines.find(l => !l.startsWith('---') && !l.startsWith('#') && l.length > 10 && l.length < 100);
            title = titleLine?.replace(/^#+\s*/, '') || '';
        }
        // Content: everything after ---CONTENT--- or after the first <h2>/<p> tag
        if (!content) {
            const contentStart = cleaned.indexOf('<h2>') !== -1 ? cleaned.indexOf('<h2>') : cleaned.indexOf('<p>');
            if (contentStart !== -1) {
                content = cleaned.slice(contentStart);
            }
        }
    }
    // Validate title — reject generic/too short titles
    const GENERIC_TITLES = ['artikel bisnis laundry', 'artikel', 'blog', 'judul artikel', 'title'];
    if (!title || title.length < 15 || GENERIC_TITLES.includes(title.toLowerCase())) {
        console.warn(`[BlogGen] ⚠️ Title rejected (generic/empty): "${title}"`);
        // Extract a better title from content h2 tags
        const h2Match = content.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (h2Match) {
            title = h2Match[1].replace(/<[^>]+>/g, '').trim();
            console.log(`[BlogGen] 🔄 Using first h2 as title: "${title}"`);
        }
        else {
            // Use first sentence of content as title
            const firstP = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
            if (firstP) {
                const firstSentence = firstP[1].replace(/<[^>]+>/g, '').split(/[.!?]/)[0].trim();
                title = firstSentence.length > 20 ? firstSentence.slice(0, 80) : 'Strategi Bisnis Laundry ' + new Date().toLocaleDateString('id-ID');
                console.log(`[BlogGen] 🔄 Using first sentence as title: "${title}"`);
            }
        }
    }
    // Validate excerpt
    if (!excerpt || excerpt.length < 20) {
        const firstP = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        excerpt = firstP ? firstP[1].replace(/<[^>]+>/g, '').slice(0, 160) : 'Tips dan strategi bisnis laundry terkini untuk pemilik usaha.';
    }
    // Validate content
    if (!content || content.length < 200) {
        console.error('[BlogGen] ❌ Content too short, article will be skipped');
        throw new Error('Generated content is too short or empty');
    }
    // Clean up markdown artifacts
    content = content.replace(/```html\s*/g, '').replace(/```\s*$/g, '').trim();
    // Sanitize: hapus karakter markdown (**, *, —) dari title, excerpt, dan content
    const sanitizeMarkdown = (text) => {
        return text
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') // **bold** → <strong>
            .replace(/\*([^*]+)\*/g, '$1') // *italic* → plain text
            .replace(/—/g, '-') // em-dash → hyphen
            .replace(/–/g, '-') // en-dash → hyphen
            .replace(/^#{1,6}\s+/gm, '') // ## heading → plain text
            .replace(/\*{2,}/g, '') // leftover ** → remove
            .replace(/\*(?![a-zA-Z])/g, '') // stray * at end → remove
            .trim();
    };
    title = sanitizeMarkdown(title);
    excerpt = sanitizeMarkdown(excerpt);
    content = sanitizeMarkdown(content);
    return {
        title,
        slug: createSlug(title),
        excerpt,
        content,
        readTime,
        category,
        sourceUrls: newsItems.map(n => n.link),
    };
}
// ── Save to Database ──────────────────────────────────────────────────────────
async function saveArticle(article) {
    const client = await db_1.pool.connect();
    try {
        const result = await client.query(`INSERT INTO blog_articles (slug, title, excerpt, content, read_time, category, status, source_urls)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)
       RETURNING id`, [article.slug, article.title, article.excerpt, article.content, article.readTime, article.category, article.sourceUrls]);
        return result.rows[0].id;
    }
    finally {
        client.release();
    }
}
// ── Main: Generate Daily Blog ─────────────────────────────────────────────────
async function generateDailyBlog() {
    console.log('[BlogGen] 🚀 Mulai generate blog harian...');
    try {
        // 1. Fetch RSS
        const allNews = await fetchRssFeeds();
        console.log(`[BlogGen] 📰 Total berita: ${allNews.length}`);
        // 2. Filter relevan
        let relevant = filterRelevantNews(allNews);
        console.log(`[BlogGen] 🎯 Berita relevan: ${relevant.length}`);
        // Kalau tidak ada berita relevan, ambil random berita bisnis
        if (relevant.length === 0) {
            console.log('[BlogGen] ⚠️ Tidak ada berita relevan, ambil random...');
            relevant = allNews.slice(0, 10);
        }
        if (relevant.length === 0) {
            return { success: false, error: 'Tidak ada berita yang bisa diambil dari RSS feeds' };
        }
        const results = [];
        let previousTopics = "";
        // Generate 2 artikel
        for (let i = 0; i < 2; i++) {
            console.log(`\n[BlogGen] 📝 Membuat Artikel ke-${i + 1}/2...`);
            // 3. Ambil 3-5 berita acak dari relevan
            const chunk = relevant.sort(() => Math.random() - 0.5).slice(0, Math.min(5, relevant.length));
            console.log(`[BlogGen] 📋 Dipilih: ${chunk.map(s => s.title).join(' | ')}`);
            try {
                // 4. Generate via Qwen
                const article = await generateArticle(chunk, previousTopics);
                console.log(`[BlogGen] ✍️  Artikel ${i + 1}: "${article.title}"`);
                // 5. Simpan ke DB
                const articleId = await saveArticle(article);
                console.log(`[BlogGen] ✅ Tersimpan! ID: ${articleId}`);
                results.push({ id: articleId, title: article.title });
                previousTopics += `- ${article.title}\n`;
                // Jeda 3 menit antar artikel (hindari rate limit + variasi konten)
                if (i < 1) {
                    console.log('[BlogGen] ⏳ Jeda 3 menit sebelum artikel berikutnya...');
                    await new Promise(r => setTimeout(r, 180_000));
                }
            }
            catch (articleError) {
                console.warn(`[BlogGen] ⚠️ Artikel ${i + 1} gagal: ${articleError.message}, lanjut ke berikutnya...`);
            }
        }
        return { success: true, articles: results };
    }
    catch (e) {
        console.error('[BlogGen] ❌ Gagal:', e.message);
        return { success: false, error: e.message };
    }
}
