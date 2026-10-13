FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
COPY scripts ./scripts
# Keep this folder on a persistent volume: it holds the database and every uploaded document.
ENV DATA_DIR=/data PORT=3000 TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "--no-warnings", "server.js"]
