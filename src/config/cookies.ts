/**
 * cookies.ts — Opsi cookie terpusat.
 *
 * Sebelumnya setiap tempat yang memanggil `res.cookie` menuliskan opsinya
 * sendiri, dan ketiganya memakai `sameSite: 'none'` di produksi. `None`
 * berarti cookie sesi IKUT TERKIRIM pada request lintas-site — persis bahan
 * bakar serangan CSRF, dan yang membuat kebocoran CORS bisa dieskalasi
 * menjadi pembajakan sesi.
 *
 * `Lax` sudah cukup: web (larklaundry.com) dan API (api.larklaundry.com)
 * berbagi registrable domain yang sama, sehingga panggilan dari web ke API
 * terhitung same-site dan cookie tetap terkirim normal. Aplikasi mobile tidak
 * terpengaruh sama sekali karena memakai Bearer token, bukan cookie.
 *
 * Bila suatu saat frontend benar-benar dilayani dari domain berbeda (mis.
 * preview *.vercel.app yang memanggil api.larklaundry.com langsung tanpa
 * rewrite), set env `COOKIE_SAMESITE=none` — tidak perlu ubah kode.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

export type CookieSameSite = 'lax' | 'strict' | 'none';

function resolveSameSite(): CookieSameSite {
  const raw = (process.env.COOKIE_SAMESITE || '').trim().toLowerCase();

  if (raw === 'none') {
    // Browser menolak SameSite=None tanpa atribut Secure. Di luar produksi
    // cookie tidak Secure, jadi 'none' akan membuat cookie dibuang diam-diam.
    return IS_PROD ? 'none' : 'lax';
  }
  if (raw === 'strict' || raw === 'lax') return raw;

  return 'lax';
}

export const COOKIE_SAME_SITE: CookieSameSite = resolveSameSite();

/** 7 hari — harus sinkron dengan masa berlaku JWT. */
export const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Cookie sesi: tidak boleh terbaca JavaScript. */
export const authCookieOptions = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: COOKIE_SAME_SITE,
  path: '/',
};

/** Cookie CSRF: sengaja terbaca JS agar bisa dikirim ulang sebagai header. */
export const csrfCookieOptions = {
  httpOnly: false,
  secure: IS_PROD,
  sameSite: COOKIE_SAME_SITE,
  path: '/',
};
