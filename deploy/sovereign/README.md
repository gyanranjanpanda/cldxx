# Sovereign installation

This profile runs the web UI, gateway, agent, MongoDB, Redis, Qdrant, and Ollama on one Docker host. The application network is `internal: true`; the default profile has no egress proxy, cloud model credentials, or external authentication. The browser is outside the Docker network, so host firewall and workstation controls still matter.

## Prepare

Use a Linux host with Docker Compose and enough memory for the selected models. Enable the Docker GPU reservation in `docker-compose.yml` on a GPU host. Put TLS in front of the web port before exposing the site to other machines.

```bash
cd deploy/sovereign
cp .env.example .env
LOCAL_AUTH_NEW_PASSWORD='choose-at-least-16-characters' node ../../backend/app/scripts/hash-local-password.mjs
```

Copy the printed hash into `LOCAL_AUTH_PASSWORD_HASH` in `.env`. Replace `INTERNAL_API_KEY` with a random value. Keep `.env` out of version control. For local testing, the web port binds to `127.0.0.1:8080` and `COOKIE_SECURE=false`. For a production reverse proxy, set `FRONTEND_URL` and `SOVEREIGN_PUBLIC_URL` to its HTTPS origin and `COOKIE_SECURE=true`. The reverse proxy should forward `/api/` and `/artifacts/` to the web service without changing the path.

Pin `OLLAMA_IMAGE`, `QDRANT_IMAGE`, `MONGO_IMAGE`, and `REDIS_IMAGE` to reviewed digests in `.env` before production release. The default tags are for evaluation.

## Install while connected

```bash
docker compose build
docker compose pull mongo redis qdrant ollama
docker volume create cldx-sovereign_ollama-models
docker run -d --name cldx-model-loader --network bridge \
  -v cldx-sovereign_ollama-models:/root/.ollama ollama/ollama:latest serve
docker exec cldx-model-loader ollama pull llama3.1
docker exec cldx-model-loader ollama pull qwen2.5-coder
docker exec cldx-model-loader ollama pull llama3.2-vision
docker exec cldx-model-loader ollama pull nomic-embed-text
docker rm -f cldx-model-loader
docker compose up -d
./verify-containment.sh
```

Wait for the model loader to answer `docker exec cldx-model-loader ollama list` before pulling. If `OLLAMA_IMAGE` is pinned to a digest, use that same image in the loader command. Pulling after the offline Compose stack starts cannot work because its network has no route out.

Open `http://localhost:8080` for local testing. Sign in with the local account from `.env`. Sovereign conversations persist in the local `cldx_sovereign` MongoDB database, separate from the ordinary `cldx` database. Back up both MongoDB databases, Redis, Qdrant, the `ollama-models` volume, the audit log, and artifacts according to your retention policy.

## Transfer to an offline host

Build and pull on a connected staging host, then export every image named by `docker compose config --images`. Transfer those image archives and the populated `ollama-models` volume through your approved process. On the offline host, load the images and volume, copy `.env`, then run:

```bash
docker compose up --no-build --pull never -d
./verify-containment.sh
```

The offline host must not attempt `ollama pull` or `docker compose build`. Test sign-in, a chat turn, a PDF or image input, and restoration from backup before calling the installation ready. Cloud search, cloud image generation, speech transcription, billing, and remote MCP integrations require external services and are unavailable in this profile.
