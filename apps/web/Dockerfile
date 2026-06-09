# syntax=docker/dockerfile:1
#
# Web image — Next.js 16 standalone server in an npm-workspace monorepo.
# Build context is the REPO ROOT (so package-lock.json + packages/crypto are
# available). next.config sets `output: 'standalone'` + `outputFileTracingRoot`
# at the repo root, producing a self-contained server under
# apps/web/.next/standalone/apps/web/server.js.

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
# Install workspace deps in-place. Two reasons we resolve fresh here rather than
# `npm ci` from the committed lockfile:
#  1) npm doesn't hoist every dep to the root node_modules (e.g. `next` lands in
#     apps/web/node_modules), so in-place install beats copying node_modules
#     across stages.
#  2) The committed package-lock.json is generated on Windows and omits the
#     Linux-native optional binaries (lightningcss, @tailwindcss/oxide,
#     @next/swc); installing strictly from it misses them. Resolving without the
#     lockfile fetches the correct-platform binaries for this image.
# Manifests only (no lockfile) so this layer caches until a package.json changes.
COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json
RUN npm install --no-audit --no-fund --loglevel=error
# Source. node_modules is .dockerignored, so this never clobbers the install.
COPY . .
# Optional .onion mirror URL, inlined into the client bundle at build time.
ARG NEXT_PUBLIC_TOR_URL
ENV NEXT_PUBLIC_TOR_URL=${NEXT_PUBLIC_TOR_URL}
ARG NEXT_PUBLIC_SOURCE_URL
ENV NEXT_PUBLIC_SOURCE_URL=${NEXT_PUBLIC_SOURCE_URL}
RUN npm run build -w web

# ── runner: minimal standalone image ─────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public
# Run as the unprivileged `node` user shipped by the base image.
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
