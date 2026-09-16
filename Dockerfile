# ─────────────────────────────────────────────────────────────────────────────
# Ex Libris Video – production image (web + worker from one Dockerfile)
#
#   docker build -t exlibrisvideo .                     → web    (default = last stage, next start)
#   docker build --target worker -t exlibrisvideo-w .   → worker (same files, runs src/worker/index.ts)
#
# Coolify (Dockerfile build pack): the web app uses the default target; the worker
# app sets "Docker build stage target" = worker. See COOLIFY.md.
#
# Stages:  base → deps (npm ci) → builder (next build)
#          runtime-base (ffmpeg, non-root user) → runtime (app files) → worker | web
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:22-bookworm-slim

# ── base ─────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

# ── deps: exact, Linux-native dependency tree (sharp, next-swc, esbuild, …) ──
# The lock file already lists the linux-x64 / linux-arm64 optional binaries, so this
# works on both Hetzner CX (x86) and CAX (Arm) servers. Host node_modules never enter
# the context (.dockerignore).
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 && node -e "require('sharp'); console.log('[docker] sharp native binding OK')"
# The image is Debian (glibc): drop the musl/Alpine and wasm variants that npm installs
# alongside the glibc binaries (~190 MB). Non-matching patterns are harmless.
RUN rm -rf node_modules/@next/swc-linux-*-musl \
      node_modules/@img/sharp-linuxmusl-* node_modules/@img/sharp-libvips-linuxmusl-* node_modules/@img/sharp-wasm32 \
      node_modules/@rolldown/binding-linux-*-musl \
      node_modules/@tailwindcss/oxide-linux-*-musl \
      node_modules/lightningcss-linux-*-musl node_modules/vite/node_modules/lightningcss-linux-*-musl \
 && node -e "require('sharp'); console.log('[docker] sharp still OK after pruning')"

# ── builder: next build ──────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
# Only what the build needs is copied explicitly: secrets such as AIApi.txt or
# .env.local can never end up in a layer, whatever the build context contains.
COPY package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY drizzle ./drizzle
COPY fixtures ./fixtures
# public/ may be missing in a git checkout (git does not track empty folders):
# the wildcard copies it when it exists and is a no-op otherwise (BuildKit).
COPY publi[c] ./public/
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_DEMO_COLLECTION_ID=""
ENV NEXT_PUBLIC_DEMO_COLLECTION_ID=${NEXT_PUBLIC_DEMO_COLLECTION_ID}
RUN mkdir -p public \
 && npm run build \
 && rm -rf .next/cache

# ── runtime-base: OS packages + unprivileged user ────────────────────────────
FROM base AS runtime-base
# ffmpeg/ffprobe: video pipeline · ca-certificates: HTTPS to AI / Open Library / e-mail APIs
# curl: Coolify's dashboard health check needs curl or wget inside the image
# tini: PID 1 that forwards SIGTERM (graceful worker shutdown) and reaps zombies
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -version | head -n 1 \
 && ffprobe -hide_banner -version | head -n 1

# Fixed ids (the entrypoint hands a root-owned storage mount to this user automatically)
ARG APP_UID=1001
ARG APP_GID=1001
RUN groupadd --gid ${APP_GID} exlibris \
 && useradd --uid ${APP_UID} --gid exlibris --create-home --home-dir /home/exlibris \
      --shell /usr/sbin/nologin exlibris \
 && mkdir -p /app/storage \
 && chown exlibris:exlibris /app/storage

# ── runtime: application files (shared by web and worker) ────────────────────
FROM runtime-base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/app/storage \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe

# Code stays root-owned (read-only for the app user); only storage/ and the Next.js
# runtime cache are writable. node_modules is copied whole: `next start` needs the
# typescript package to load next.config.ts, and the worker runs TypeScript via tsx.
# Nothing here comes from the `builder` stage, so `--target worker` never runs `next build`
# (the memory-heavy step): web and worker can build side by side on a small server.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.ts tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY fixtures ./fixtures
RUN chown exlibris:exlibris /app/storage

# No VOLUME instruction on purpose: an anonymous volume would silently give web and
# worker two different, never-cleaned-up storages. Mount /app/storage explicitly
# (Coolify: Directory Mount on BOTH apps; docker-compose.yml: shared volume).

# No `USER exlibris` here: the container starts as root so docker-entrypoint.sh can hand a freshly
# mounted (root-owned) storage directory to the app user, then it drops to exlibris with setpriv.
# The Node processes never run as root.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# One health check for both roles – Coolify uses an image HEALTHCHECK instead of its
# dashboard setting, so it must not fail for the worker (which serves no HTTP):
#   * worker container: healthy while the worker process (src/worker/index.ts) runs
#     (the [r] keeps grep from matching its own command line)
#   * web container:    GET /api/health must answer 2xx (503 when the DB is unreachable)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD grep -qsa 'src/worke[r]/index' /proc/[0-9]*/cmdline \
   || node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]

# The commands below are exactly what `npm run worker` / `npm run start` execute, minus the
# npm + /bin/sh wrappers: dash does not pass SIGTERM on, so under `npm run …` a `docker stop`
# (every Coolify redeploy) killed the worker without its graceful shutdown (finish or
# re-queue running jobs). Now: tini → tsx (relays SIGTERM) → worker; tini → next.

# ── worker: background jobs (no HTTP, no domain) ─────────────────────────────
FROM runtime AS worker
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/worker/index.ts"]

# ── web: Next.js server (default target – keep this stage last) ──────────────
FROM runtime AS web
COPY --from=builder /app/.next  ./.next
COPY --from=builder /app/public ./public
RUN mkdir -p .next/cache \
 && chown -R exlibris:exlibris .next/cache
EXPOSE 3000
# `next start` listens on $PORT (default 3000) on all interfaces
CMD ["node", "node_modules/next/dist/bin/next", "start"]
