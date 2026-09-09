# Pin Bun consistently across build and runtime stages.
FROM oven/bun:1.4.0-alpine AS checked
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json index.ts ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
COPY tests ./tests
RUN bun run typecheck && bun test

FROM oven/bun:1.4.0-alpine AS web
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=checked --chown=bun:bun /app/index.ts ./index.ts
COPY --from=checked --chown=bun:bun /app/src/server ./src/server
COPY --from=checked --chown=bun:bun /app/src/shared ./src/shared
COPY --from=checked --chown=bun:bun /app/src/web ./src/web
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD bun -e 'fetch("http://127.0.0.1:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["bun", "index.ts"]

FROM oven/bun:1.4.0-alpine AS cli
WORKDIR /app
COPY --from=checked --chown=bun:bun /app/src/cli ./src/cli
USER bun
ENTRYPOINT ["bun", "src/cli/index.ts"]
CMD ["--help"]

FROM postgres:17-alpine AS ops
COPY --from=checked /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=checked /app/src/server ./src/server
COPY --from=checked /app/src/shared ./src/shared
COPY --from=checked /app/scripts ./scripts
COPY --from=checked /app/migrations ./migrations
RUN addgroup -g 1000 budget && adduser -D -u 1000 -G budget budget
USER budget
ENTRYPOINT ["bun"]
CMD ["scripts/migrate.ts"]
