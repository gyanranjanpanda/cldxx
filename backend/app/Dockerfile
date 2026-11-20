# Gateway service — optimised for Cloud Run
# Build context: backend/

FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app/package*.json ./app/
RUN cd app && npm ci --omit=dev

COPY app ./app
COPY shared ./shared

WORKDIR /app/app

# Cloud Run injects PORT at runtime. The default here is only for local docker
# runs where PORT isn't set externally.
ENV NODE_ENV=production \
    PORT=8000

EXPOSE 8000

# Direct node invocation: receives SIGTERM from Cloud Run and shuts down
# cleanly without an npm wrapper in the process tree.
CMD ["node", "index.js"]
