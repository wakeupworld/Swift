FROM node:22-alpine

RUN apk add --no-cache ffmpeg su-exec tini tzdata

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 568 = TrueNAS SCALE "apps" user/group.
ENV PUID=568 \
    PGID=568 \
    DATA_DIR=/data \
    RECORDINGS_DIR=/recordings \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    NODE_ENV=production

VOLUME ["/data", "/recordings"]

HEALTHCHECK --interval=2m --timeout=10s --start-period=2m --retries=3 \
  CMD find /data/heartbeat -mmin -3 | grep -q heartbeat || exit 1

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["run"]
