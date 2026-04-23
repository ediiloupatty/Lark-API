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
  category: string;
  sourceUrls: string[];
}

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
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'tips-operasional': ['efisiensi', 'efisien', 'optimasi', 'produktivitas', 'operasional', 'hemat', 'energi', 'workflow'],
  'panduan-pemula': ['pemula', 'memulai', 'dari nol', 'panduan', 'langkah', 'cara'],
  'keuangan': ['biaya', 'hitung', 'untung', 'keuangan', 'modal', 'harga', 'tarif', 'pricing'],
  'teknologi': ['digital', 'aplikasi', 'teknologi', 'otomasi', 'transformasi', 'software', 'online'],
  'inspirasi': ['sukses', 'kisah', 'motivasi', 'inspirasi', 'viral', 'tren', 'nostalgia'],
  'industri': ['industri', 'regulasi', 'pasar', 'persaingan', 'ekonomi', 'kebijakan'],
};

function detectCategoryFallback(text: string): string {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 'bisnis';
}

// ── Fetch Existing Topics from Database ───────────────────────────────────────
// Query semua judul artikel yang sudah ada di DB agar AI tidak membuat topik duplikat
async function fetchExistingTopics(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT title FROM blog_articles ORDER BY created_at DESC LIMIT 100`
    );
    return result.rows.map((r: { title: string }) => r.title);
  } catch (e: any) {
    console.warn(`[BlogGen] ⚠️ Gagal fetch existing topics: ${e.message}`);
    return [];
  } finally {
    client.release();
  }
}

// ── Title Similarity Check ────────────────────────────────────────────────────
// Cek apakah judul baru terlalu mirip dengan judul yang sudah ada di database.
// Menggunakan word overlap ratio: jika >= 50% kata sama → dianggap duplikat.
function isTitleTooSimilar(newTitle: string, existingTitles: string[]): { similar: boolean; matchedTitle?: string } {
  const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const newWords = new Set(normalize(newTitle));
  if (newWords.size === 0) return { similar: false };

  for (const existing of existingTitles) {
    const existingWords = new Set(normalize(existing));
    if (existingWords.size === 0) continue;

    // Hitung kata yang sama
    let overlap = 0;
    for (const word of newWords) {
      if (existingWords.has(word)) overlap++;
    }

    // Jika 50% atau lebih kata overlap → terlalu mirip
    const ratio = overlap / Math.min(newWords.size, existingWords.size);
    if (ratio >= 0.5) {
      return { similar: true, matchedTitle: existing };
    }
  }

  return { similar: false };
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
                content: `Kamu adalah Andi, seorang mantan pemilik laundry kiloan di Surabaya yang sekarang jadi content writer freelance untuk blog Lark Laundry. Kamu punya pengalaman 7 tahun di bisnis laundry dan sangat paham seluk-beluk industri ini dari pengalaman langsung.

GAYA MENULIS (WAJIB IKUTI):
- Tulis seperti manusia sungguhan yang sedang bercerita ke teman sesama pengusaha laundry. BUKAN seperti robot atau AI.
- Campur kalimat pendek dan panjang secara ACAK. Kadang 5 kata. Kadang 30 kata dalam satu kalimat yang mengalir natural.
- Pakai bahasa Indonesia sehari-hari yang profesional tapi tidak kaku. Boleh pakai "nggak", "banget", "nih", "sih", "dong", "deh" secara natural.
- Sesekali mulai paragraf dengan "Nah,", "Jujur aja,", "Yang menarik,", "Gini ceritanya," atau ekspresi natural lainnya.
- Sisipkan opini pribadi dan pengalaman (boleh fiktif tapi realistis). Contoh: "Waktu saya masih punya laundry di daerah Rungkut..." atau "Teman saya yang punya laundry di Bekasi pernah cerita..."
- JANGAN pakai frasa AI yang khas: "Di era digital ini", "Dalam konteks ini", "Perlu diketahui bahwa", "Dengan demikian", "Tak bisa dipungkiri", "Menariknya", "Yang perlu digarisbawahi".
- JANGAN buat semua paragraf panjangnya sama. Variasi: ada yang 1 kalimat, ada yang 4-5 kalimat.
- Boleh ada kalimat yang sedikit "imperfect" - seperti tulisan manusia yang tidak selalu sempurna grammarnya.
- Tambahkan detail spesifik lokal: nama daerah, harga real, merek produk nyata (Rinso, Downy, Molto, dll).
- Sesekali ajak pembaca berpikir dengan pertanyaan retoris yang natural.`,
              },
              { role: 'user', content: prompt },
            ],
            temperature: 0.9,
            top_p: 0.95,
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

async function generateArticle(newsItems: RssItem[], previousTopics: string = '', existingTopics: string[] = []): Promise<GeneratedArticle> {
  const newsContext = newsItems
    .map((n, i) => `Berita ${i + 1}: "${n.title}"\n${n.description}`)
    .join('\n\n');

  // Format daftar topik yang sudah ada di database untuk dimasukkan ke prompt
  const existingTopicsBlock = existingTopics.length > 0
    ? `\nARTIKEL YANG SUDAH ADA DI DATABASE (DILARANG KERAS menulis topik yang sama atau mirip):\n${existingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\nKamu WAJIB membuat topik yang BENAR-BENAR BARU dan BERBEDA dari semua judul di atas. Jangan pakai judul yang mirip, jangan pakai sudut pandang yang sama, dan jangan pakai kata kunci utama yang sama.\n`
    : '';

  const prompt = `Buat 1 artikel blog untuk website Lark Laundry. Ambil inspirasi dari berita-berita ini, tapi JANGAN copy-paste. Kamu harus menulis ulang total dengan gaya sendiri.

Berita Referensi:
${newsContext}
${existingTopicsBlock}
${previousTopics ? `TOPIK YANG SUDAH ADA (WAJIB BEDA):\n${previousTopics}\n` : ''}

CARA MENULIS (INI YANG PALING PENTING):

1. ANTI-DETEKSI AI — Tulisanmu HARUS terasa ditulis manusia asli:
   - Variasi panjang kalimat WAJIB acak. Contoh: "Boros. Itu kata yang paling sering saya dengar dari pemilik laundry soal tagihan listrik. Padahal kalau mau dihitung-hitung, sebenarnya ada banyak cara untuk pangkas biaya operasional tanpa harus mengorbankan kualitas cucian yang kita berikan ke pelanggan."
   - Boleh pakai kalimat pendek untuk efek dramatis. Satu kata pun boleh jadi paragraf.
   - JANGAN mulai semua paragraf dengan pola yang sama. Variasi: pertanyaan, pernyataan, cerita, data, opini.
   - WAJIB sisipkan 2-3 cerita/anekdot personal (boleh fiktif tapi realistis). Contoh: "Dulu saya pernah salah pilih deterjen bulk dari supplier di Tanah Abang..."
   - Pakai bahasa Indonesia santai tapi profesional. Boleh: "nggak", "banget", "nih", "sih", "emang".

2. FRASA TERLARANG (JANGAN PERNAH PAKAI):
   - "Di era digital ini" / "Di era modern"
   - "Perlu diketahui bahwa" / "Dengan demikian"
   - "Tak bisa dipungkiri" / "Menariknya"
   - "Yang perlu digarisbawahi" / "Dalam konteks ini"
   - "Penting untuk dicatat" / "Sebagai kesimpulan"
   - "Mari kita" / "Pada akhirnya"
   - Jangan buka artikel dengan kalimat definisi atau pernyataan umum.

3. PEMBUKA ARTIKEL — Mulai dengan salah satu:
   - Cerita personal/anekdot: "Minggu lalu, pelanggan tetap saya komplain soal..."
   - Pertanyaan provokatif: "Kapan terakhir kali kamu ngecek tagihan listrik laundry-mu? Coba lihat lagi deh."
   - Fakta mengejutkan: "Rata-rata laundry kiloan di Jabodetabek kehilangan Rp2,3 juta per bulan cuma gara-gara..."
   - JANGAN buka dengan "Di tengah..." atau "Pada tahun..."

4. KONTEN BERKUALITAS:
   - Sisipkan data/angka spesifik (boleh estimasi realistis)
   - Sebutkan nama kota, daerah, merek nyata (Rinso, Downy, Molto, Electrolux, LG)
   - Berikan minimal 3-5 tips yang BENAR-BENAR bisa dipraktikkan
   - Tambahkan perbandingan harga atau kalkulasi sederhana kalau relevan
   - Akhiri dengan CTA natural (bukan hard-sell) mengajak coba Lark Laundry

5. FORMAT HTML:
   - Gunakan HANYA: <h2>, <h3>, <p>, <ul>, <li>, <ol>, <strong>, <blockquote>
   - JANGAN pakai <h1>. JANGAN pakai markdown (**, *, ##, ---).
   - Untuk dash, pakai "-" biasa, BUKAN "—" (em-dash).
   - Minimal 800 kata.

FORMAT OUTPUT (HARUS PERSIS):
---TITLE---
[Judul clickbait-worthy tapi jujur, max 80 karakter, pakai angka kalau bisa. Contoh bagus: "5 Kesalahan Fatal Pemilik Laundry yang Bikin Rugi Jutaan"]
---EXCERPT---
[1-2 kalimat yang bikin orang penasaran, max 160 karakter]
---CATEGORY---
[Pilih SATU: tips-operasional, panduan-pemula, keuangan, teknologi, inspirasi, industri]
---READTIME---
[estimasi, contoh: "6 min"]
---CONTENT---
[Artikel HTML lengkap, minimal 800 kata, WAJIB terasa ditulis manusia]`;

  const raw = await callQwen(prompt);

  // Log raw response for debugging
  console.log(`[BlogGen] 📄 Raw response (first 300 chars): ${raw.slice(0, 300)}`);

  // Clean up any markdown wrapper Qwen might add
  let cleaned = raw
    .replace(/^```[\s\S]*?\n/, '')     // Remove opening ```markdown or ```
    .replace(/\n```\s*$/, '')           // Remove closing ```
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
  } else {
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
    } else {
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
  const sanitizeMarkdown = (text: string): string => {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') // **bold** → <strong>
      .replace(/\*([^*]+)\*/g, '$1')    // *italic* → plain text
      .replace(/—/g, '-')               // em-dash → hyphen
      .replace(/–/g, '-')               // en-dash → hyphen
      .replace(/^#{1,6}\s+/gm, '')      // ## heading → plain text
      .replace(/\*{2,}/g, '')           // leftover ** → remove
      .replace(/\*(?![a-zA-Z])/g, '')   // stray * at end → remove
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
async function saveArticle(article: GeneratedArticle): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO blog_articles (slug, title, excerpt, content, read_time, category, status, source_urls)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)
       RETURNING id`,
      [article.slug, article.title, article.excerpt, article.content, article.readTime, article.category, article.sourceUrls]
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
    // 0. Fetch existing topics dari database untuk hindari duplikat
    const existingTopics = await fetchExistingTopics();
    console.log(`[BlogGen] 📚 Artikel existing di DB: ${existingTopics.length} judul`);
    if (existingTopics.length > 0) {
      console.log(`[BlogGen] 📋 Contoh judul terakhir: ${existingTopics.slice(0, 5).join(' | ')}`);
    }

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
    // Track semua topik (DB + baru dibuat hari ini) untuk pengecekan duplikat
    const allKnownTopics = [...existingTopics];

    // Generate 2 artikel
    for (let i = 0; i < 2; i++) {
      console.log(`\n[BlogGen] 📝 Membuat Artikel ke-${i + 1}/2...`);
      // 3. Ambil 3-5 berita acak dari relevan
      const chunk = relevant.sort(() => Math.random() - 0.5).slice(0, Math.min(5, relevant.length));
      console.log(`[BlogGen] 📋 Dipilih: ${chunk.map(s => s.title).join(' | ')}`);

      // Retry loop: jika judul terlalu mirip dengan existing, coba generate ulang (max 3x)
      let article: GeneratedArticle | null = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          // 4. Generate via Qwen (dengan daftar topik existing)
          const candidate = await generateArticle(chunk, previousTopics, allKnownTopics);

          // 5. Cek similaritas judul dengan semua topik yang sudah ada
          const similarityCheck = isTitleTooSimilar(candidate.title, allKnownTopics);
          if (similarityCheck.similar) {
            console.warn(`[BlogGen] 🔄 Judul "${candidate.title}" terlalu mirip dengan "${similarityCheck.matchedTitle}". Retry ${retry + 1}/3...`);
            // Tambahkan info retry ke previousTopics agar AI tahu harus berbeda
            previousTopics += `- DITOLAK (mirip existing): ${candidate.title}\n`;
            continue;
          }

          article = candidate;
          break;
        } catch (genError: any) {
          console.warn(`[BlogGen] ⚠️ Generate retry ${retry + 1} gagal: ${genError.message}`);
        }
      }

      if (!article) {
        console.warn(`[BlogGen] ⚠️ Artikel ${i + 1} gagal setelah 3 retry (semua mirip existing), skip...`);
        continue;
      }

      try {
        console.log(`[BlogGen] ✍️  Artikel ${i + 1}: "${article.title}"`);

        // 6. Simpan ke DB
        const articleId = await saveArticle(article);
        console.log(`[BlogGen] ✅ Tersimpan! ID: ${articleId}`);

        results.push({ id: articleId, title: article.title });
        previousTopics += `- ${article.title}\n`;
        allKnownTopics.push(article.title);

        // Jeda 3 menit antar artikel (hindari rate limit + variasi konten)
        if (i < 1) {
          console.log('[BlogGen] ⏳ Jeda 3 menit sebelum artikel berikutnya...');
          await new Promise(r => setTimeout(r, 180_000));
        }
      } catch (articleError: any) {
        console.warn(`[BlogGen] ⚠️ Artikel ${i + 1} gagal simpan: ${articleError.message}, lanjut ke berikutnya...`);
      }
    }

    return { success: true, articles: results };
  } catch (e: any) {
    console.error('[BlogGen] ❌ Gagal:', e.message);
    return { success: false, error: e.message };
  }
}
