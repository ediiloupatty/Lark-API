# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# ── Stage 1: Install dependencies ─────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm install prisma tsx typescript

# ── Stage 2: Build (generate Prisma client) ───────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client (schema-based, no DB connection needed)
RUN npx prisma generate

# ── Stage 3: Production image ─────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install tini for proper signal handling (graceful shutdown)
RUN apk add --no-cache tini

# Copy only what's needed
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Firebase credential di-bake ke image (bukan bind mount) agar tidak auto-create directory
COPY firebase-service-account.json ./firebase-service-account.json

EXPOSE 3000

# Tini ensures SIGTERM is properly forwarded to Node process
ENTRYPOINT ["/sbin/tini", "--"]

# tsx langsung jalankan TypeScript tanpa compile step
CMD ["node_modules/.bin/tsx", "src/index.ts"]
