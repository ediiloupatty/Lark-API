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

import { pool } from '../config/db';

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

// ── Interfaces ────────────────────────────────────────────────────────────────
interface RssItem {
  title: string;
  description: string;
  link: string;
}

interface GeneratedArticle {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  readTime: string;
  sourceUrls: string[];
}

// ── RSS Parser (lightweight, no external dependency) ──────────────────────────
function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = [];
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

function extractTag(xml: string, tag: string): string {
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : '';
}

function cleanHtml(text: string): string {
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
async function fetchRssFeeds(): Promise<RssItem[]> {
  const allItems: RssItem[] = [];

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
    } catch (e: any) {
      console.warn(`[BlogGen] RSS error ${feedUrl}: ${e.message}`);
    }
  }

  return allItems;
}

// ── Filter by Keywords ────────────────────────────────────────────────────────
function filterRelevantNews(items: RssItem[]): RssItem[] {
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

async function callQwen(prompt: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY tidak ditemukan di .env');

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
        if (!text) throw new Error('Qwen response kosong');
        
        console.log(`[BlogGen] ✅ ${model} berhasil!`);
        return text;
      } catch (e: any) {
        if (attempt === 3) console.warn(`[BlogGen] ❌ ${model} gagal setelah 3 percobaan: ${e.message}`);
      }
    }
  }

  throw new Error('Semua model Qwen gagal. Coba lagi nanti.');
}

// ── Generate Article ──────────────────────────────────────────────────────────
function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100)
    + '-' + Date.now().toString(36);
}

async function generateArticle(newsItems: RssItem[], previousTopics: string = ''): Promise<GeneratedArticle> {
  const newsContext = newsItems
    .map((n, i) => `Berita ${i + 1}: "${n.title}"\n${n.description}`)
    .join('\n\n');

  const prompt = `Kamu adalah penulis blog profesional untuk Lark Laundry, platform manajemen bisnis laundry di Indonesia.

Dari berita-berita berikut, buatkan 1 artikel blog UNIK dalam Bahasa Indonesia yang relevan untuk pelaku bisnis laundry/UMKM. Jika berita tidak terkait laundry, jadikan itu sebagai studi kasus, cerita lucu, tren viral, inspirasi nostalgia, atau pelajaran bisnis, TAPI selalu hubungkan kembali (bridge) ke operasional bisnis laundry agar relevan dan tidak membingungkan CEO atau pembaca kami.

Berita Sumber:
${newsContext}

${previousTopics ? `JANGAN MENGULANG TOPIK INI (Sudah dibahas sebelumnya hari ini):\n${previousTopics}\n\n` : ''}

ATURAN:
1. JANGAN copy-paste berita. Tulis ulang dengan sudut pandang baru yang relevan untuk pemilik bisnis laundry.
2. Gunakan gaya bahasa yang profesional, menarik, santai, tapi mudah dipahami.
3. Sertakan tips praktis yang bisa diterapkan oleh pemilik laundry.
4. Hubungkan dengan konteks bisnis laundry di Indonesia.

FORMAT OUTPUT (HARUS PERSIS):
---TITLE---
[Judul artikel yang menarik, max 80 karakter]
---EXCERPT---
[Ringkasan singkat 1-2 kalimat, max 160 karakter]
---READTIME---
[estimasi waktu baca, contoh: "5 min"]
---CONTENT---
[Konten artikel dalam format HTML. Gunakan tag: <h2>, <h3>, <p>, <ul>, <li>, <strong>. JANGAN gunakan <h1>. Panjang minimal 800 kata.]`;

  const raw = await callQwen(prompt);

  // Parse response
  const titleMatch = raw.match(/---TITLE---\s*([\s\S]*?)---EXCERPT---/);
  const excerptMatch = raw.match(/---EXCERPT---\s*([\s\S]*?)---READTIME---/);
  const readTimeMatch = raw.match(/---READTIME---\s*([\s\S]*?)---CONTENT---/);
  const contentMatch = raw.match(/---CONTENT---\s*([\s\S]*)/);

  const title = titleMatch?.[1]?.trim() || 'Artikel Bisnis Laundry';
  const excerpt = excerptMatch?.[1]?.trim() || 'Tips dan insight untuk bisnis laundry Anda.';
  const readTime = readTimeMatch?.[1]?.trim() || '5 min';
  let content = contentMatch?.[1]?.trim() || '<p>Konten tidak tersedia.</p>';

  // Clean up markdown artifacts jika ada
  content = content.replace(/```html\s*/g, '').replace(/```\s*$/g, '').trim();

  return {
    title,
    slug: createSlug(title),
    excerpt,
    content,
    readTime,
    sourceUrls: newsItems.map(n => n.link),
  };
}

// ── Save to Database ──────────────────────────────────────────────────────────
async function saveArticle(article: GeneratedArticle): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO blog_articles (slug, title, excerpt, content, read_time, status, source_urls)
       VALUES ($1, $2, $3, $4, $5, 'published', $6)
       RETURNING id`,
      [article.slug, article.title, article.excerpt, article.content, article.readTime, article.sourceUrls]
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

// ── Main: Generate Daily Blog ─────────────────────────────────────────────────
export async function generateDailyBlog(): Promise<{ success: boolean; articles?: any[]; error?: string }> {
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

      // 4. Generate via Gemini/Qwen
      const article = await generateArticle(chunk, previousTopics);
      console.log(`[BlogGen] ✍️  Artikel ${i + 1}: "${article.title}"`);

      // 5. Simpan ke DB
      const articleId = await saveArticle(article);
      console.log(`[BlogGen] ✅ Tersimpan! ID: ${articleId}`);

      results.push({ id: articleId, title: article.title });
      previousTopics += `- ${article.title}\n`;
    }

    return { success: true, articles: results };
  } catch (e: any) {
    console.error('[BlogGen] ❌ Gagal:', e.message);
    return { success: false, error: e.message };
  }
}
