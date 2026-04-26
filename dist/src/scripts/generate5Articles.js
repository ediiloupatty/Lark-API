"use strict";
/**
 * generate5Articles.ts — One-time Script
 * Generate 5 artikel blog dengan topik berbeda dan menarik
 *
 * Usage: npx tsx src/scripts/generate5Articles.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
const db_1 = require("../config/db");
// ── RSS Feed Sources ──────────────────────────────────────────────────────────
const RSS_FEEDS = [
    'https://www.antaranews.com/rss/ekonomi-bisnis.xml',
    'https://www.cnnindonesia.com/ekonomi/rss',
    'https://www.cnbcindonesia.com/news/rss',
    'https://sindikasi.okezone.com/index.php/rss/0/RSS2.0',
    'https://www.antaranews.com/rss/teknologi.xml',
    'https://www.cnnindonesia.com/teknologi/rss',
];
const KEYWORDS = [
    'laundry', 'binatu', 'cuci', 'pakaian',
    'umkm', 'usaha kecil', 'bisnis', 'wirausaha',
    'franchise', 'waralaba', 'startup', 'digital',
    'pelaku usaha', 'pengusaha', 'ekonomi kreatif',
    'operasional', 'manajemen', 'produktivitas',
    'viral', 'lucu', 'unik', 'sejarah', 'nostalgia', 'kisah sukses',
    'teknologi', 'ai', 'aplikasi', 'otomasi', 'keuangan', 'investasi',
    'lingkungan', 'ramah lingkungan', 'hemat energi', 'air',
];
// ── 5 TEMA BERBEDA (menarik, viral-worthy, relevan bisnis laundry) ──
const TEMA_ARTIKEL = [
    {
        tema: 'Teknologi AI & Otomasi untuk Bisnis Laundry',
        sudut: 'Bahas bagaimana AI, chatbot, IoT, dan otomasi mengubah bisnis laundry tradisional. Berikan contoh konkret implementasi teknologi di laundry modern. Sebutkan bagaimana platform seperti Lark Laundry membantu digitalisasi.',
        category: 'teknologi',
    },
    {
        tema: 'Tips Hemat Biaya Operasional Laundry di Tengah Kenaikan Harga',
        sudut: 'Fokus ke strategi keuangan: cara hemat listrik mesin cuci, efisiensi penggunaan air dan deterjen, negosiasi supplier, dan manajemen stok. Berikan kalkulasi ROI sederhana yang bisa dipahami pemula.',
        category: 'keuangan',
    },
    {
        tema: 'Kisah Sukses UMKM Laundry: Dari Modal 5 Juta ke Omzet Ratusan Juta',
        sudut: 'Tulis gaya storytelling inspiratif tentang perjalanan pelaku UMKM laundry di Indonesia. Ceritakan tantangan, strategi marketing kreatif, dan bagaimana mereka scale up bisnis. Buat pembaca termotivasi untuk memulai atau mengembangkan bisnis laundry mereka.',
        category: 'inspirasi',
    },
    {
        tema: 'Go Green: Tren Laundry Ramah Lingkungan yang Disukai Gen Z',
        sudut: 'Tren eco-laundry global dan di Indonesia: deterjen organik, mesin hemat air, packaging biodegradable, carbon footprint rendah. Hubungkan dengan preferensi Gen Z dan milenial yang peduli lingkungan. Berikan data tentang potensi pasar eco-laundry.',
        category: 'industri',
    },
    {
        tema: 'Panduan Lengkap Memulai Bisnis Laundry Kiloan di 2025',
        sudut: 'Step-by-step komprehensif untuk pemula: riset lokasi strategis, kalkulasi modal awal (detail), pemilihan peralatan, menentukan harga jual, SOP operasional, hingga strategi marketing digital (Instagram, Google Maps, WhatsApp). Panduan paling lengkap.',
        category: 'panduan-pemula',
    },
];
const VALID_CATEGORIES = [
    'tips-operasional',
    'panduan-pemula',
    'keuangan',
    'teknologi',
    'inspirasi',
    'industri',
];
// ── RSS Parser ────────────────────────────────────────────────────────────────
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
                console.warn(`[Gen5] RSS gagal: ${feedUrl} (${res.status})`);
                continue;
            }
            const xml = await res.text();
            const items = parseRssXml(xml);
            allItems.push(...items);
            console.log(`[Gen5] ✅ ${items.length} items dari ${feedUrl}`);
        }
        catch (e) {
            console.warn(`[Gen5] RSS error ${feedUrl}: ${e.message}`);
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
// ── Qwen AI via DashScope ─────────────────────────────────────────────────────
const QWEN_MODELS = [
    'qwen-flash-2025-07-28',
    'qwen3.5-flash',
    'qwen3-coder-flash',
];
const DASHSCOPE_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
async function callQwen(prompt) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey)
        throw new Error('DASHSCOPE_API_KEY not found in .env');
    for (const model of QWEN_MODELS) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[Gen5] 🤖 Trying ${model} (attempt ${attempt}/3)...`);
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
                                content: 'Kamu adalah penulis blog profesional senior untuk Lark Laundry, platform manajemen bisnis laundry di Indonesia. Tulis dalam Bahasa Indonesia yang profesional, engaging, informatif, dan mudah dipahami. Setiap artikel harus memiliki value tinggi bagi pembaca.',
                            },
                            { role: 'user', content: prompt },
                        ],
                        temperature: 0.85,
                        max_tokens: 4096,
                    }),
                });
                if (res.status === 429) {
                    console.warn(`[Gen5] ⏳ Rate limited (${model}), waiting 15s...`);
                    await new Promise(r => setTimeout(r, 15000));
                    continue;
                }
                if (!res.ok) {
                    const errText = await res.text();
                    console.warn(`[Gen5] ⚠️ ${model} error ${res.status}: ${errText.slice(0, 200)}`);
                    break; // Try next model
                }
                const json = await res.json();
                const text = json?.choices?.[0]?.message?.content;
                if (!text)
                    throw new Error('Qwen response kosong');
                console.log(`[Gen5] ✅ ${model} berhasil!`);
                return text;
            }
            catch (e) {
                if (attempt === 3) {
                    console.warn(`[Gen5] ❌ ${model} gagal setelah 3 percobaan: ${e.message}`);
                }
            }
        }
    }
    throw new Error('Semua model Qwen gagal. Coba lagi nanti.');
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function createSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 100)
        + '-' + Date.now().toString(36);
}
function sanitizeMarkdown(text) {
    return text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/—/g, '-')
        .replace(/–/g, '-')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*{2,}/g, '')
        .replace(/```html\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim();
}
// ── Generate & Save Single Article ────────────────────────────────────────────
async function generateAndSave(tema, newsContext, previousTopics) {
    const prompt = `Kamu adalah penulis blog profesional senior untuk Lark Laundry, platform manajemen bisnis laundry di Indonesia.

TEMA SPESIFIK ARTIKEL INI: ${tema.tema}
SUDUT PANDANG: ${tema.sudut}

Referensi berita terkini Indonesia (gunakan sebagai data/konteks saja, JANGAN copy-paste):
${newsContext}

${previousTopics ? `TOPIK YANG SUDAH DITULIS (WAJIB PILIH SUDUT PANDANG YANG BERBEDA TOTAL):\n${previousTopics}\nPilih angle yang BENAR-BENAR BERBEDA dari topik di atas.\n\n` : ''}

ATURAN KETAT:
1. JUDUL harus spesifik, menarik, dan clickbait-worthy (tapi TIDAK misleading). Max 80 karakter.
2. Tulis minimal 800 kata, informatif, actionable, dan memberikan value nyata.
3. DILARANG KERAS menggunakan karakter markdown: **, *, --, ##, ###.
4. Gunakan HANYA tag HTML: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <blockquote>, <ol>.
5. JANGAN gunakan <h1>. JANGAN gunakan markdown.
6. Sertakan minimal 3-5 tips praktis yang bisa langsung diterapkan pemilik laundry.
7. Gunakan data/angka konkret jika memungkinkan untuk memperkuat argumen.
8. Buat pembaca merasa "Wah, artikel ini berguna banget!" dan ingin share ke teman.
9. Tambahkan call-to-action di akhir artikel yang mengajak pembaca mencoba Lark Laundry.

FORMAT OUTPUT (HARUS PERSIS):
---TITLE---
[Judul menarik dan spesifik, max 80 karakter]
---EXCERPT---
[Ringkasan 1-2 kalimat compelling, max 160 karakter]
---CATEGORY---
${tema.category}
---READTIME---
[estimasi, contoh: "7 min"]
---CONTENT---
[Konten artikel dalam HTML murni, minimal 800 kata, gunakan <h2>, <h3>, <p>, <ul>, <li>, <strong>]`;
    const raw = await callQwen(prompt);
    // Log raw response preview
    console.log(`[Gen5] 📄 Raw (first 200 chars): ${raw.slice(0, 200)}`);
    // Clean markdown wrappers
    let cleaned = raw
        .replace(/^```[\s\S]*?\n/, '')
        .replace(/\n```\s*$/, '')
        .trim();
    // Parse delimiters
    const titleMatch = cleaned.match(/---\s*TITLE\s*---\s*([\s\S]*?)---\s*EXCERPT\s*---/i);
    const excerptMatch = cleaned.match(/---\s*EXCERPT\s*---\s*([\s\S]*?)---\s*CATEGORY\s*---/i);
    const categoryMatch = cleaned.match(/---\s*CATEGORY\s*---\s*([\s\S]*?)---\s*READTIME\s*---/i);
    const readTimeMatch = cleaned.match(/---\s*READTIME\s*---\s*([\s\S]*?)---\s*CONTENT\s*---/i);
    const contentMatch = cleaned.match(/---\s*CONTENT\s*---\s*([\s\S]*)/i);
    let title = titleMatch?.[1]?.trim().replace(/^["']+|["']+$/g, '') || '';
    let excerpt = excerptMatch?.[1]?.trim().replace(/^["']+|["']+$/g, '') || '';
    const rawCategory = categoryMatch?.[1]?.trim().toLowerCase().replace(/^["']+|["']+$/g, '') || tema.category;
    const readTime = readTimeMatch?.[1]?.trim() || '5 min';
    let content = contentMatch?.[1]?.trim() || '';
    const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : tema.category;
    // Sanitize
    title = sanitizeMarkdown(title);
    excerpt = sanitizeMarkdown(excerpt);
    content = sanitizeMarkdown(content);
    // Validate title
    const GENERIC_TITLES = ['artikel bisnis laundry', 'artikel', 'blog', 'judul artikel', 'title'];
    if (!title || title.length < 15 || GENERIC_TITLES.includes(title.toLowerCase())) {
        console.warn(`[Gen5] ⚠️ Title rejected: "${title}"`);
        const h2Match = content.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (h2Match) {
            title = h2Match[1].replace(/<[^>]+>/g, '').trim();
            console.log(`[Gen5] 🔄 Using h2 as title: "${title}"`);
        }
        else {
            title = tema.tema;
            console.log(`[Gen5] 🔄 Using tema as title: "${title}"`);
        }
    }
    // Validate excerpt
    if (!excerpt || excerpt.length < 20) {
        const firstP = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        excerpt = firstP
            ? firstP[1].replace(/<[^>]+>/g, '').slice(0, 160)
            : 'Tips dan strategi bisnis laundry terkini untuk pemilik usaha.';
    }
    // Validate content
    if (!content || content.length < 200) {
        throw new Error('Content terlalu pendek atau kosong');
    }
    const slug = createSlug(title);
    // Save to DB
    const client = await db_1.pool.connect();
    try {
        const result = await client.query(`INSERT INTO blog_articles (slug, title, excerpt, content, read_time, category, status, source_urls)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)
       RETURNING id`, [slug, title, excerpt, content, readTime, category, []]);
        return { id: result.rows[0].id, title };
    }
    finally {
        client.release();
    }
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('[Gen5] 🚀 Generate 5 Artikel Blog dengan Topik Berbeda');
    console.log('[Gen5] ⏰ Waktu mulai: ' + new Date().toISOString());
    console.log('='.repeat(60));
    // 1. Fetch RSS
    const allNews = await fetchRssFeeds();
    console.log(`[Gen5] 📰 Total berita: ${allNews.length}`);
    let relevant = filterRelevantNews(allNews);
    console.log(`[Gen5] 🎯 Berita relevan: ${relevant.length}`);
    if (relevant.length === 0) {
        console.log('[Gen5] ⚠️ Tidak ada berita relevan, ambil random...');
        relevant = allNews.slice(0, 20);
    }
    if (relevant.length === 0) {
        console.error('[Gen5] ❌ Tidak ada berita dari RSS feeds!');
        await db_1.pool.end();
        process.exit(1);
    }
    let previousTopics = '';
    const results = [];
    for (let i = 0; i < 5; i++) {
        const tema = TEMA_ARTIKEL[i];
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`[Gen5] 📝 [${i + 1}/5] Tema: ${tema.tema}`);
        console.log(`[Gen5] 📂 Kategori: ${tema.category}`);
        console.log(`${'─'.repeat(50)}`);
        // Pilih berita acak
        const shuffled = [...relevant].sort(() => Math.random() - 0.5);
        const chunk = shuffled.slice(0, 5);
        const newsContext = chunk
            .map((n, j) => `Berita ${j + 1}: "${n.title}"\n${n.description}`)
            .join('\n\n');
        try {
            const article = await generateAndSave(tema, newsContext, previousTopics);
            console.log(`[Gen5] ✅ Artikel ${i + 1}: "${article.title}" (ID: ${article.id})`);
            results.push({ ...article, category: tema.category });
            previousTopics += `- ${article.title} (kategori: ${tema.category})\n`;
            // Jeda 30 detik antar artikel (hindari rate limit)
            if (i < 4) {
                console.log('[Gen5] ⏳ Jeda 30 detik sebelum artikel berikutnya...');
                await new Promise(r => setTimeout(r, 30000));
            }
        }
        catch (err) {
            console.error(`[Gen5] ❌ Artikel ${i + 1} gagal: ${err.message}`);
        }
    }
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('[Gen5] 📊 HASIL GENERATE 5 ARTIKEL:');
    console.log('='.repeat(60));
    results.forEach((r, i) => {
        console.log(`  ${i + 1}. [${r.category}] ${r.title} (ID: ${r.id})`);
    });
    console.log(`\n[Gen5] ✅ Total berhasil: ${results.length}/5`);
    console.log('[Gen5] ⏰ Selesai: ' + new Date().toISOString());
    console.log('='.repeat(60));
    await db_1.pool.end();
    process.exit(results.length > 0 ? 0 : 1);
}
main().catch((e) => {
    console.error('[Gen5] Fatal error:', e);
    process.exit(1);
});
