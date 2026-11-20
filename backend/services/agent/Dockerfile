# Agent service — optimised for Cloud Run
# Build context: backend/
#
# Cloud Run constraints respected here:
#   - PORT env var is read by index.js (not hardcoded)
#   - /tmp is writable for Multer uploads (in-memory, cleared per instance)
#   - artifacts/ and temp/ should point to GCS in production via storage.js

FROM node:22-slim

# Use the distro Chromium so the build never reaches a Google CDN.
# Required for sovereign installs and air-gapped Cloud Build runners.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY services/agent/package*.json ./services/agent/
RUN cd services/agent && npm ci --omit=dev

COPY services/agent ./services/agent
COPY shared ./shared

WORKDIR /app/services/agent

# Created here so the process owner can write without root.
# In Cloud Run these are ephemeral — point storage.js at GCS for persistence.
RUN mkdir -p audit artifacts temp

ENV NODE_ENV=production \
    PORT=8003

EXPOSE 8003

CMD ["node", "index.js"]
