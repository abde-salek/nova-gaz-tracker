# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=base /app /app

RUN chown -R appuser:appgroup /app
USER appuser

# Cloud Run sets PORT automatically
ENV NODE_ENV=production
ENV TZ=Africa/Casablanca

EXPOSE 8080

CMD ["node", "src/index.js"]
