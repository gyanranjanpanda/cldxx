# Gateway (auth, chat, billing). Build context is backend/.
FROM node:22-slim

WORKDIR /app

# Dependencies are baked in at build time. A sovereign host has no route to
# npm, so anything not in the image is not available at runtime -- which is the
# point, and the reason the offline bundle is a supported install path.
COPY app/package*.json ./app/
RUN cd app && npm ci --omit=dev

COPY app ./app
COPY shared ./shared

WORKDIR /app/app

ENV NODE_ENV=production
EXPOSE 8000

CMD ["node", "index.js"]
