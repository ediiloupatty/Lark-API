<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20_LTS-339933?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/License-Proprietary-red" />
</p>

# Lark Laundry — Backend API

> **Multi-tenant SaaS REST API** for laundry business management.  
> Handles order lifecycle, multi-outlet operations, offline-first mobile sync, real-time notifications, and financial reporting.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Order State Machine](#order-state-machine)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Backup & Disaster Recovery](#backup--disaster-recovery)
- [Integrations](#integrations)
- [Scripts & Commands](#scripts--commands)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Lark Laundry API is the backend engine powering the Lark Laundry SaaS platform — a comprehensive solution for laundry businesses in Indonesia. It supports:

- **Multi-tenant architecture** — one deployment serves multiple independent businesses
- **Multi-outlet management** — each tenant can operate multiple physical outlets
- **Offline-first mobile sync** — full CRUD capability even without internet connectivity
- **State-machine-driven orders** — auditable, deterministic order lifecycle
- **Real-time notifications** — push (FCM) + WhatsApp (Fonnte) integration
- **Role-based access control** — owner, admin, karyawan, pelanggan

**Clients:** Web Admin Dashboard (React), Mobile POS App (Flutter)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  Web Admin   │  │  Mobile App  │  │  Public Website    │    │
│  │  (React)     │  │  (Flutter)   │  │  (Next.js SSR)     │    │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘    │
└─────────┼─────────────────┼───────────────────┼────────────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     NGINX (Reverse Proxy)                       │
│  • SSL Termination  • Rate Limiting  • Gzip  • Static Cache   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS.JS APPLICATION                        │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Middlewares  │  │  Controllers │  │     Services       │    │
│  │ • Auth JWT  │──▶│  • Order     │──▶│  • Sync Engine    │    │
│  │ • Rate Limit│  │  • Customer  │  │  • FCM Push       │    │
│  │ • Helmet    │  │  • Finance   │  │  • WhatsApp API   │    │
│  │ • CORS      │  │  • Dashboard │  │  • Blog Generator │    │
│  │ • Maint.    │  │  • Auth      │  │  • Audit Logger   │    │
│  └─────────────┘  └──────────────┘  └────────────────────┘    │
│                           │                                     │
│                    ┌──────▼──────┐                              │
│                    │ Prisma ORM  │                              │
│                    └──────┬──────┘                              │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                  ┌─────────▼─────────┐
                  │   PostgreSQL 16   │
                  │   (22 Tables)     │
                  └───────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| **Runtime** | Node.js 20 LTS | Server runtime |
| **Language** | TypeScript 5.x | Type safety & DX |
| **Framework** | Express.js 5.x | HTTP routing & middleware |
| **ORM** | Prisma 7.x | Type-safe database access |
| **Database** | PostgreSQL 16 | Primary datastore |
| **Auth** | JWT + bcrypt | Token auth (24h expiry) + password hashing |
| **OAuth** | google-auth-library | Google SSO |
| **Security** | Helmet + CORS | HTTP headers + origin whitelist |
| **Push** | Firebase Admin SDK 13.x | FCM mobile notifications |
| **Messaging** | Fonnte API | WhatsApp business messaging |
| **Email** | Nodemailer 8.x | Transactional email (password reset) |
| **AI** | Qwen (DashScope) | Auto blog content generation |
| **Container** | Docker Compose | PostgreSQL containerization |
| **Process Mgr** | PM2 | Production process management |

---

## Getting Started

### Prerequisites

| Requirement | Minimum Version |
|:---|:---|
| Node.js | 20.x LTS |
| npm | 10.x |
| Docker & Docker Compose | 24.x / 2.x |
| PostgreSQL (or Docker) | 16.x |

### Installation

```bash
# 1. Clone repository
git clone https://github.com/ediiloupatty/Lark-API.git
cd Lark-API

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env
# Edit .env with your actual values (see Configuration section)

# 4. Start PostgreSQL via Docker
docker compose up -d

# 5. Generate Prisma client
npx prisma generate

# 6. Run database migrations
npx prisma migrate deploy

# 7. Seed initial data
npm run seed

# 8. Start development server
npm run dev
```

The API will be available at `http://localhost:3000/api/v1`

---

## Configuration

All configuration is managed via environment variables. **Never commit `.env` files.**

```env
# ──────────────────────────────────────────────────
# DATABASE
# ──────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:password@localhost:5432/db_laundry

# ──────────────────────────────────────────────────
# AUTHENTICATION
# ──────────────────────────────────────────────────
JWT_SECRET=<random-string-min-64-chars>      # openssl rand -hex 32
GOOGLE_CLIENT_ID=<your-google-client-id>

# ──────────────────────────────────────────────────
# APPLICATION
# ──────────────────────────────────────────────────
APP_URL=https://www.larklaundry.com
PORT=3000
NODE_ENV=production                          # development | production

# ──────────────────────────────────────────────────
# EMAIL (Transactional — Password Reset)
# ──────────────────────────────────────────────────
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=<email@gmail.com>
MAIL_PASS=<app-password>

# ──────────────────────────────────────────────────
# EXTERNAL SERVICES
# ──────────────────────────────────────────────────
FONNTE_TOKEN=<fonnte-whatsapp-api-token>
FIREBASE_SERVICE_ACCOUNT=firebase-service-account.json
DASHSCOPE_API_KEY=<alibaba-dashscope-api-key>
```

---

## Project Structure

```
backend-node/
│
├── src/
│   ├── index.ts                         # Application entry point
│   ├── seed-packages.ts                 # Database seeder
│   │
│   ├── config/
│   │   └── db.ts                        # Prisma client singleton
│   │
│   ├── controllers/                     # Request handlers (business logic)
│   │   ├── authController.ts            #   Login, register, OAuth, password reset
│   │   ├── orderController.ts           #   Order CRUD, status transitions, audit
│   │   ├── customerController.ts        #   Customer management
│   │   ├── serviceController.ts         #   Laundry services catalog
│   │   ├── outletController.ts          #   Multi-outlet management
│   │   ├── staffController.ts           #   Staff/employee management
│   │   ├── financeController.ts         #   Financial reports, expenses
│   │   ├── dashboardController.ts       #   Analytics & KPI dashboard
│   │   ├── settingsController.ts        #   Tenant configuration
│   │   ├── profileController.ts         #   User profile management
│   │   ├── packageController.ts         #   Subscription packages
│   │   ├── notificationController.ts    #   Push & WhatsApp notifications
│   │   ├── blogController.ts            #   Blog articles (public API)
│   │   ├── publicController.ts          #   Health check, public info
│   │   ├── syncPushController.ts        #   Mobile → Server sync
│   │   └── syncPullController.ts        #   Server → Mobile sync
│   │
│   ├── routes/                          # Route definitions
│   │   ├── authRoutes.ts
│   │   ├── blogRoutes.ts
│   │   └── syncRoutes.ts
│   │
│   ├── middlewares/                      # Express middleware
│   │   ├── authMiddleware.ts            #   JWT validation & tenant isolation
│   │   ├── rateLimiter.ts               #   IP-based rate limiting
│   │   └── maintenanceMiddleware.ts     #   Maintenance mode gate
│   │
│   ├── services/                        # External service integrations
│   │   ├── SyncService.ts               #   Offline-first sync engine
│   │   ├── firebaseService.ts           #   FCM push notifications
│   │   ├── whatsappService.ts           #   Fonnte WhatsApp API
│   │   └── blogGeneratorService.ts      #   AI-powered blog generator
│   │
│   ├── scripts/
│   │   └── generateBlog.ts              #   Standalone cron script
│   │
│   └── utils/                           # Shared utilities
│       ├── authUtils.ts                 #   JWT sign/verify helpers
│       ├── auditHelper.ts               #   Audit trail writer
│       └── mailer.ts                    #   Email transport
│
├── prisma/
│   ├── schema.prisma                    # Database schema (22 tables)
│   └── migrations/                      # Version-controlled migrations
│
├── docker-compose.yml                   # PostgreSQL container
├── Dockerfile                           # API container image
├── .env.example                         # Environment template
├── package.json
└── tsconfig.json
```

---

## API Reference

**Base URL:** `https://api.larklaundry.com/api/v1`

All protected endpoints require `Authorization: Bearer <JWT>` header.

### Authentication

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---:|
| `POST` | `/auth/login` | Email/password login | ✗ |
| `POST` | `/auth/google` | Google OAuth SSO | ✗ |
| `POST` | `/auth/register` | Register new account | ✗ |
| `POST` | `/auth/forgot-password` | Request password reset email | ✗ |
| `POST` | `/auth/reset-password` | Reset password with token | ✗ |

### Orders

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---:|
| `GET` | `/orders` | List orders (paginated, filterable) | ✓ |
| `POST` | `/orders` | Create new order | ✓ |
| `GET` | `/orders/:id` | Get order detail | ✓ |
| `PUT` | `/orders/:id` | Update order data | ✓ |
| `PATCH` | `/orders/:id/status` | Transition order status | ✓ |

### Customers

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---:|
| `GET` | `/customers` | List customers (search, paginate) | ✓ |
| `POST` | `/customers` | Create new customer | ✓ |
| `PUT` | `/customers/:id` | Update customer | ✓ |
| `DELETE` | `/customers/:id` | Soft delete customer | ✓ |

### Catalog & Operations

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---:|
| `GET/POST` | `/services` | Laundry services CRUD | ✓ |
| `GET/POST` | `/outlets` | Multi-outlet management | ✓ |
| `GET/POST` | `/staff` | Staff/employee management | ✓ |
| `GET` | `/dashboard` | Analytics & KPI data | ✓ |
| `GET` | `/finance/*` | Financial reports | ✓ |

### Mobile Sync (Offline-First)

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---:|
| `POST` | `/sync/push` | Mobile → Server data push | ✓ |
| `GET` | `/sync/pull` | Server → Mobile data pull | ✓ |

### Public

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---:|
| `GET` | `/health` | Health check / readiness probe | ✗ |
| `GET` | `/blog` | List blog articles (paginated) | ✗ |
| `GET` | `/blog/:slug` | Blog article by slug | ✗ |

---

## Database Schema

**22 tables** managed by Prisma ORM with version-controlled migrations.

### Core Tables

| Table | Purpose | Key Relations |
|:---|:---|:---|
| `users` | User accounts (all roles) | → tenants, outlets |
| `tenants` | Business entities | → users, outlets, orders |
| `outlets` | Physical store locations | → tenant, orders, staff |
| `customers` | Customer registry | → tenant, orders |

### Order Management

| Table | Purpose |
|:---|:---|
| `orders` | Order header (status, totals, tracking) |
| `order_details` | Line items (service, qty, berat, satuan, durasi, modifier) |
| `order_status_logs` | **Audit trail** — every status change recorded |
| `payments` | Payment records (supports DP/deposit parsial) |

### Operations

| Table | Purpose |
|:---|:---|
| `services` | Laundry service catalog |
| `paket_laundry` | Service packages (duration modifiers) |
| `expenses` | Operational expenses |
| `inventory` | Supply stock (detergent, etc.) |
| `reports` | Financial report snapshots |

### Platform

| Table | Purpose |
|:---|:---|
| `subscription_packages` | SaaS subscription plans |
| `tenant_settings` | Per-tenant configuration |
| `audit_logs` | System-wide action audit |
| `user_sessions` | Active session tracking |
| `device_tokens` | FCM push notification tokens |
| `notifications` | In-app notification inbox |
| `promotions` | Discount/promo campaigns |
| `reviews` | Customer reviews |
| `webhook_logs` | Payment gateway webhook audit |

---

## Order State Machine

Orders follow a strict, auditable state machine. Every transition is logged in `order_status_logs`.

```
                    ┌──────────────┐
                    │   DITERIMA   │  ← Initial state (order created)
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
              ┌─────│   DIPROSES   │─────┐
              │     └──────┬───────┘     │
              │            │             │
              ▼            ▼             ▼
     ┌────────────┐ ┌─────────────┐ ┌────────────┐
     │ DIBATALKAN  │ │SIAP_DIANTAR │ │SIAP_DIAMBIL│
     └────────────┘ └──────┬──────┘ └─────┬──────┘
                           │              │
                           ▼              ▼
                    ┌──────────────┐
                    │   SELESAI    │  ← Requires payment = lunas
                    └──────────────┘
```

### Valid Transitions

| From | To | Condition |
|:---|:---|:---|
| `diterima` | `diproses` | — |
| `diterima` | `dibatalkan` | Payment ≠ lunas |
| `diproses` | `siap_diantar` / `siap_diambil` | — |
| `diproses` | `dibatalkan` | Payment ≠ lunas |
| `siap_diantar` / `siap_diambil` | `selesai` | Payment = lunas |

### Payment States

| Status | Description |
|:---|:---|
| `pending` | No payment received |
| `dp` | Partial deposit paid (remainder due at pickup) |
| `lunas` | Fully paid |
| `dibatalkan` | Payment cancelled |

---

## Security

| Layer | Implementation | Details |
|:---|:---|:---|
| **Authentication** | JWT (HS256) | 24-hour expiry, refresh not implemented |
| **SSO** | Google OAuth | Via `google-auth-library` token verification |
| **Password** | bcrypt (12 rounds) | Salted hash storage |
| **HTTP Headers** | Helmet.js | HSTS, X-Frame-Options, CSP, etc. |
| **CORS** | Whitelist-only | No wildcard `*` origins |
| **Rate Limiting** | Nginx + Express | Auth: 3 req/s, API: 10 req/s |
| **SQL Injection** | Prisma ORM | Parameterized queries (prepared statements) |
| **Input Validation** | Controller-level | All user input sanitized before processing |
| **Tenant Isolation** | Middleware | Every query scoped to `tenant_id` from JWT |
| **Audit Trail** | `audit_logs` + `order_status_logs` | Every mutation logged with actor + timestamp |

---

## Testing

```bash
# Run all tests
npm run test

# Watch mode (re-run on file changes)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

---

## Deployment

### Production (VPS with PM2)

```bash
# 1. Install PM2
npm install -g pm2

# 2. Clone & install
git clone <repo-url> && cd backend-node
npm ci --production

# 3. Setup env & database
cp .env.example .env && nano .env
npx prisma generate && npx prisma migrate deploy

# 4. Start with PM2
pm2 start "npm run start" --name lark-api
pm2 save && pm2 startup
```

### Docker

```bash
docker build -t lark-api .
docker run -d -p 3000:3000 --env-file .env lark-api
```

### Nginx Reverse Proxy (recommended)

```nginx
server {
    listen 443 ssl http2;
    server_name api.larklaundry.com;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Rate limiting
        limit_req zone=api burst=20 nodelay;
    }
}
```

---

## Backup & Disaster Recovery

| Item | Configuration |
|:---|:---|
| **Schedule** | Daily at 03:00 WIB (UTC+7) |
| **Method** | `pg_dump` → gzip → integrity check → upload |
| **Cloud Storage** | Cloudflare R2 (S3-compatible) |
| **Local Retention** | 7 days |
| **Cloud Retention** | 90 days (lifecycle policy) |
| **Retry Policy** | 3 attempts with 10s backoff |

---

## Integrations

### Firebase Cloud Messaging (FCM)

Push notifications for order status updates, promotional campaigns.

### WhatsApp Business (Fonnte)

Automated order confirmations, tracking links, and pickup reminders.

### AI Blog Generator (Qwen)

Automated daily blog content generation for SEO.

| Config | Value |
|:---|:---|
| **Model** | Qwen via Alibaba DashScope |
| **Schedule** | Daily at 06:00 WIB |
| **Output** | 2 articles/day, 800+ words each |
| **Sources** | 7 Indonesian news RSS feeds |
| **Safety** | Title validation, markdown sanitization, topic deduplication |

```bash
# Manual trigger
npx tsx src/scripts/generateBlog.ts

# Cron setup (VPS)
0 6 * * * cd /var/www/larklaundry/backend-node && npx tsx src/scripts/generateBlog.ts >> logs/blog-cron.log 2>&1
```

---

## Scripts & Commands

| Command | Description |
|:---|:---|
| `npm run dev` | Start dev server (hot reload via tsx watch) |
| `npm run start` | Start production server |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run seed` | Seed subscription packages |
| `npm run test` | Run test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate test coverage report |
| `npx prisma generate` | Regenerate Prisma client |
| `npx prisma migrate dev` | Create new migration |
| `npx prisma migrate deploy` | Apply pending migrations |
| `npx prisma studio` | Open Prisma database GUI |

---

## Contributing

1. Create a feature branch from `main`
2. Follow existing code patterns and naming conventions
3. Ensure all tests pass (`npm run test`)
4. Ensure TypeScript compiles without errors (`npx tsc --noEmit`)
5. Submit a Pull Request with clear description

---

## Built With AI

This project was developed with the assistance of AI-powered tools:

| Tool | Role |
|:---|:---|
| <img src="https://img.shields.io/badge/Anthropic-Claude_Opus_4.6-D97706?logo=anthropic&logoColor=white" /> | Architecture design, code generation, debugging |
| <img src="https://img.shields.io/badge/Google-Gemini_3.1_Pro-4285F4?logo=google&logoColor=white" /> | Code review, optimization, best practice analysis |
| <img src="https://img.shields.io/badge/OpenAI-Codex-412991?logo=openai&logoColor=white" /> | Code completion, refactoring assistance |
| <img src="https://img.shields.io/badge/Google_DeepMind-Antigravity-34A853?logo=google&logoColor=white" /> | AI-powered text editor for development workflow |

> All AI-generated code has been reviewed, tested, and validated by the developer before deployment.

---

## License

**Proprietary** — © 2026 Edi Loupatty. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, distribution, or modification is strictly prohibited.
