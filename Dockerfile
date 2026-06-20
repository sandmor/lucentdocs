# syntax=docker/dockerfile:1

FROM oven/bun:1 AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    libsqlite3-dev \
    pkg-config \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/

RUN bun install --frozen-lockfile

COPY . .

RUN bun run --filter './packages/core' build
RUN bun run build

FROM oven/bun:1 AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsqlite3-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=5677 \
  LUCENTDOCS_DATA_DIR=/app/data

COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages

RUN mkdir -p /app/data \
  && chown -R bun:bun /app

USER bun

EXPOSE 5677

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:5677/.well-known/docker-health').then((r)=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "--filter", "./apps/api", "start"]
