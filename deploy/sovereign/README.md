# Sovereign installation

**Windows PowerShell users:** run `.\install.ps1` from `cldxx\deploy\sovereign`. Do not run `./install.sh`: it is a Bash script for macOS and Linux, and Windows may open it in an editor without installing anything. If you already cloned the repository, do not clone it again; go to that folder and run `.\install.ps1`.

This profile runs the web UI, gateway, agent, MongoDB, Redis, Qdrant, and Ollama on one Docker host. The gateway, agent, models, and data stores use an `internal: true` network with no route out. Only the web proxy also joins an ingress bridge so its loopback-published port works. The default profile has no cloud model credentials or external authentication. The browser is outside the Docker network, so host firewall and workstation controls still matter.

## Install on each user's own computer

Each person installs their own copy. Their models, account, conversations, and artifacts stay in Docker volumes on **their computer**. This does not connect to the hosted CLDX account or your AWS server. Installation downloads code, images, and models; the running application network is isolated. The default web port is bound to the local loopback address, so there is no public deployment link.

Requirements: a running Docker Desktop (macOS/Windows) or Docker Engine with Compose v2 (Linux), enough free disk for models and containers, and preferably at least 8 GB of memory available to Docker. The installer selects smaller 1.5B chat and coding models plus a compact vision model; responses will be less capable than larger models. CPU-only inference may be slow. Mobile devices and machines that cannot run Docker are not supported.

The repository is public. Each user can either use Git as shown below or download the [source ZIP](https://github.com/gyanranjanpanda/cldxx/archive/refs/heads/master.zip), extract it, and run the installer from `cldxx-master/deploy/sovereign`. With a ZIP download, use `bash install.sh` on macOS/Linux or `.\install.ps1` on Windows.

macOS or Linux:

```bash
git clone https://github.com/gyanranjanpanda/cldxx.git
cd cldxx/deploy/sovereign
./install.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/gyanranjanpanda/cldxx.git
Set-Location .\cldxx\deploy\sovereign
.\install.ps1
```

If PowerShell blocks the downloaded script, run `Unblock-File .\install.ps1` and retry. Docker Desktop must be installed and running before either installer starts.

Create a password when prompted, then open **http://127.0.0.1:8080** on that same computer and sign in as `admin`. The installer creates a private `.env`, downloads models into a local Docker volume, builds and starts the services, and checks that the application network is isolated. Do not share the `.env` file. Running the installer again reuses the same account and volumes.

If you forget the local password, reset it on that computer. Choose at least 8 characters. The command prompts twice without showing the password, changes only the password hash in `.env`, and recreates the app container. Conversations, models, and artifacts remain in their volumes.

```bash
cd cldxx/deploy/sovereign
./reset-password.sh
```

To use larger models, edit `SOVEREIGN_MODEL`, `SOVEREIGN_CODING_MODEL`, and `SOVEREIGN_VISION_MODEL` in your local `.env`, then rerun the installer to download them. To stop without deleting data, run `docker compose down` from this directory. To update, run `git pull` and rerun the installer.

This local profile supports local chat, coding, embeddings, and image *inputs*. It does not provide image generation; the hosted ComfyUI ngrok endpoint cannot be reached from the isolated application network.

The manual Linux server installation below is for operators who need a separate dedicated host. Users installing on personal computers should use the commands above.

## Prepare

Use a Linux host with Docker Compose and enough memory for the selected models. Enable the Docker GPU reservation in `docker-compose.yml` on a GPU host. Put TLS in front of the web port before exposing the site to other machines.

```bash
cd deploy/sovereign
cp .env.example .env
LOCAL_AUTH_NEW_PASSWORD='choose-at-least-8-characters' node ../../backend/app/scripts/hash-local-password.mjs
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

Open `http://127.0.0.1:8080` for local testing. Sign in with the local account from `.env`. Sovereign conversations persist in the local `cldx_sovereign` MongoDB database, separate from the ordinary `cldx` database. Back up both MongoDB databases, Redis, Qdrant, the `ollama-models` volume, the audit log, and artifacts according to your retention policy.

## Transfer to an offline host

Build and pull on a connected staging host, then export every image named by `docker compose config --images`. Transfer those image archives and the populated `ollama-models` volume through your approved process. On the offline host, load the images and volume, copy `.env`, then run:

```bash
docker compose up --no-build --pull never -d
./verify-containment.sh
```

The offline host must not attempt `ollama pull` or `docker compose build`. Test sign-in, a chat turn, a PDF or image input, and restoration from backup before calling the installation ready. Cloud search, cloud image generation, speech transcription, billing, and remote MCP integrations require external services and are unavailable in this profile.
