FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    RIG_MEDIA_DIR=/var/lib/boresakshi/rig-media \
    BACKUP_DIR=/var/lib/boresakshi/backups
WORKDIR /app
RUN groupadd --gid 10001 boresakshi \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin boresakshi \
    && mkdir -p /var/lib/boresakshi/rig-media /var/lib/boresakshi/backups \
    && chown -R boresakshi:boresakshi /var/lib/boresakshi
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=boresakshi:boresakshi . .
USER boresakshi
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["npm", "run", "start:production"]
