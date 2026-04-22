# 🧺 LarkLaundry — Backend API

Backend REST API untuk platform LarkLaundry. Dibangun dengan **Node.js + Express + TypeScript**, menggunakan **Prisma ORM** dan **PostgreSQL** sebagai database.

---

## 🛠️ Tech Stack

| Teknologi | Versi | Fungsi |
|:---|:---|:---|
| Node.js | 20 LTS | Runtime |
| TypeScript | 6.x | Type safety |
| Express.js | 5.x | HTTP framework |
| Prisma ORM | 7.x | Database ORM (type-safe queries) |
| PostgreSQL | 16 | Database (Docker container) |
| JWT | — | Authentication (24 jam expiry) |
| bcrypt | 6.x | Password hashing |
| Nodemailer | 8.x | Email (reset password) |
| Firebase Admin | 13.x | Push notification (FCM) |
| google-auth-library | 10.x | Google OAuth token verification |
| Helmet | 8.x | HTTP security headers |
| CORS | — | Whitelist-based origin control |

---

## 📂 Struktur Kode

```
backend-node/
├── src/
│   ├── index.ts                    # Entry point (Express server)
│   ├── seed-packages.ts            # Seeder untuk subscription packages
│   ├── config/
│   │   └── db.ts                   # Prisma client configuration
│   ├── controllers/
│   │   ├── authController.ts       # Login, register, Google OAuth, reset password
│   │   ├── orderController.ts      # CRUD pesanan, status tracking
│   │   ├── customerController.ts   # Manajemen pelanggan
│   │   ├── serviceController.ts    # Layanan laundry (cuci, setrika, dll.)
│   │   ├── outletController.ts     # Multi-outlet management
│   │   ├── staffController.ts      # Manajemen staf/karyawan
│   │   ├── financeController.ts    # Laporan keuangan, pengeluaran
│   │   ├── dashboardController.ts  # Data analytics & statistik
│   │   ├── settingsController.ts   # Tenant settings (info toko)
│   │   ├── profileController.ts    # Profil user
│   │   ├── packageController.ts    # Subscription packages
│   │   ├── notificationController.ts # Push notification & WhatsApp
│   │   ├── publicController.ts     # Public endpoints (health, info)
│   │   ├── syncPushController.ts   # Mobile → Server data sync
│   │   └── syncPullController.ts   # Server → Mobile data sync
│   ├── routes/
│   │   ├── authRoutes.ts           # Auth-related routes
│   │   └── syncRoutes.ts           # Offline sync routes
│   ├── middlewares/
│   │   ├── authMiddleware.ts       # JWT token validation
│   │   ├── rateLimiter.ts          # IP-based rate limiting
│   │   └── maintenanceMiddleware.ts # Maintenance mode toggle
│   ├── services/
│   │   ├── firebaseService.ts      # FCM push notification
│   │   ├── whatsappService.ts      # Fonnte WhatsApp API
│   │   └── SyncService.ts          # Offline-first sync logic
│   └── utils/
│       ├── authUtils.ts            # JWT sign/verify helpers
│       ├── auditHelper.ts          # Audit log writer
│       └── mailer.ts               # Nodemailer email sender
├── prisma/
│   ├── schema.prisma               # Database schema (21 tabel)
│   └── migrations/                 # Migration history
├── docker-compose.yml              # PostgreSQL container
├── Dockerfile                      # Backend container image
├── .env.example                    # Template environment variables
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- npm

### Development
```bash
# 1. Clone & install
git clone <repo-url>
cd backend-node
npm install

# 2. Setup environment
cp .env.example .env
nano .env   # Isi semua variabel

# 3. Jalankan PostgreSQL
docker compose up -d

# 4. Generate Prisma client
npx prisma generate

# 5. Seed subscription packages
npm run seed

# 6. Jalankan development server
npm run dev
# → API tersedia di: http://localhost:3000/api/v1
```

### Production (VPS)
```bash
# Install PM2 globally
npm install -g pm2

# Start backend
pm2 start "npm run start" --name lark-backend
pm2 save
pm2 startup
```

---

## 🔑 Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/db_laundry

# JWT
JWT_SECRET=your-random-string-min-64-chars

# Email (reset password)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=email@gmail.com
MAIL_PASS=xxxx-xxxx-xxxx-xxxx

# App
APP_URL=https://www.larklaundry.com
PORT=3000
NODE_ENV=production

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id

# WhatsApp (Fonnte)
FONNTE_TOKEN=your-fonnte-token

# Firebase
FIREBASE_SERVICE_ACCOUNT=firebase-service-account.json
```

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Deskripsi |
|:---|:---|:---|
| POST | `/api/v1/auth/login` | Login email/password |
| POST | `/api/v1/auth/google` | Login via Google OAuth |
| POST | `/api/v1/auth/register` | Register user baru |
| POST | `/api/v1/auth/forgot-password` | Kirim email reset password |
| POST | `/api/v1/auth/reset-password` | Reset password dengan token |

### Orders
| Method | Endpoint | Deskripsi |
|:---|:---|:---|
| GET | `/api/v1/orders` | List semua pesanan tenant |
| POST | `/api/v1/orders` | Buat pesanan baru |
| PUT | `/api/v1/orders/:id` | Update pesanan |
| PATCH | `/api/v1/orders/:id/status` | Update status pesanan |

### Sync (Mobile Offline-First)
| Method | Endpoint | Deskripsi |
|:---|:---|:---|
| POST | `/api/v1/sync/push` | Mobile → Server push data |
| GET | `/api/v1/sync/pull` | Server → Mobile pull data |

### Others
| Method | Endpoint | Deskripsi |
|:---|:---|:---|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/dashboard` | Dashboard analytics |
| GET/POST | `/api/v1/customers` | Manajemen pelanggan |
| GET/POST | `/api/v1/services` | Layanan laundry |
| GET/POST | `/api/v1/outlets` | Multi-outlet |
| GET/POST | `/api/v1/staff` | Manajemen staf |
| GET | `/api/v1/finance/*` | Laporan keuangan |

---

## 🗄️ Database Schema

21 tabel PostgreSQL, dikelola via Prisma ORM:

| Tabel | Fungsi |
|:---|:---|
| `users` | Akun (owner, admin, karyawan, pelanggan) |
| `tenants` | Data tenant/usaha laundry |
| `outlets` | Cabang/outlet per tenant |
| `services` | Layanan (Cuci Biasa, Cuci Setrika, dll.) |
| `orders` | Pesanan laundry |
| `order_details` | Detail per item pesanan |
| `customers` | Data pelanggan |
| `payments` | Riwayat pembayaran |
| `expenses` | Pengeluaran operasional |
| `subscription_packages` | Paket berlangganan (1/3/12 bulan) |
| `tenant_settings` | Konfigurasi toko per tenant |
| `audit_logs` | Log semua aksi user |
| `user_sessions` | Session management |
| `device_tokens` | FCM token device mobile |
| `notifications` | Notifikasi in-app |
| `promotions` | Promo/diskon |
| `inventory` | Stok bahan (detergen, pewangi, dll.) |
| `paket_laundry` | Paket layanan bundling |
| `reports` | Laporan keuangan |
| `reviews` | Review pelanggan |
| `webhook_logs` | Log webhook payment gateway |

---

## 🔐 Keamanan

- **JWT Authentication** — token 24 jam, validasi di setiap request
- **Google OAuth** — SSO via `google-auth-library`
- **bcrypt** — password hashing
- **Helmet** — HTTP security headers
- **CORS** — whitelist-based (bukan wildcard)
- **Rate Limiting** — Nginx-level (auth: 3r/s, API: 10r/s)
- **Input Validation** — semua input divalidasi
- **Prepared Statements** — Prisma ORM (anti SQL injection)
- **Audit Log** — setiap login & mutasi tercatat

---

## 🗄️ Database Backup

| Item | Detail |
|:---|:---|
| **Schedule** | Harian jam 03:00 WIB |
| **Method** | `pg_dump` → gzip → integrity check → Cloudflare R2 |
| **Retry** | 3x dengan jeda 10 detik |
| **Lokal** | 7 hari retention |
| **Cloud (R2)** | 90 hari retention (Cloudflare lifecycle rule) |

---

## 🧪 Scripts

```bash
npm run dev     # Development (tsx watch, auto-reload)
npm run start   # Production (tsx)
npm run seed    # Seed subscription packages
```

---

© 2026 **Edi Loupatty** — LarkLaundry Backend.
