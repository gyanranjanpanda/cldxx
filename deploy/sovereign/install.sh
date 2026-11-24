#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
repo_root="$(cd ../.. && pwd)"
env_file="$PWD/.env"

command -v docker >/dev/null || { echo "Install Docker Desktop or Docker Engine first." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is needed to create the local key." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Start Docker, then run this installer again." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required." >&2; exit 1; }

if [[ ! -f "$env_file" ]]; then
  printf 'Create a password for this computer (at least 16 characters): '
  IFS= read -rs local_password
  printf '\n'
  if [[ ${#local_password} -lt 16 ]]; then
    echo "Password must contain at least 16 characters." >&2
    exit 1
  fi

  export LOCAL_AUTH_NEW_PASSWORD="$local_password"
  unset local_password
  password_hash="$(docker run --rm --network none --env LOCAL_AUTH_NEW_PASSWORD \
    --mount "type=bind,source=$repo_root/backend/app,target=/app,readonly" \
    --workdir /app node:22-slim node scripts/hash-local-password.mjs)"
  unset LOCAL_AUTH_NEW_PASSWORD
  [[ "$password_hash" =~ ^[a-f0-9]{32}:[a-f0-9]{128}$ ]] || {
    echo "Could not create the password hash." >&2; exit 1;
  }

  internal_key="$(openssl rand -hex 32)"
  umask 077
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      INTERNAL_API_KEY=*) printf 'INTERNAL_API_KEY=%s\n' "$internal_key" ;;
      LOCAL_AUTH_PASSWORD_HASH=*) printf 'LOCAL_AUTH_PASSWORD_HASH=%s\n' "$password_hash" ;;
      SOVEREIGN_MODEL=*) printf 'SOVEREIGN_MODEL=qwen2.5:1.5b\n' ;;
      SOVEREIGN_CODING_MODEL=*) printf 'SOVEREIGN_CODING_MODEL=qwen2.5-coder:1.5b\n' ;;
      SOVEREIGN_VISION_MODEL=*) printf 'SOVEREIGN_VISION_MODEL=moondream:1.8b\n' ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example > "$env_file"
  chmod 600 "$env_file"
  unset internal_key password_hash
  echo "Created a private local account (username: admin)."
else
  echo "Using the existing .env. Your account and data will be preserved."
fi

env_value() {
  local value
  value="$(sed -n "s/^$1=//p" "$env_file" | tail -n 1)"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  printf '%s' "$value"
}

model="$(env_value SOVEREIGN_MODEL)"
coding_model="$(env_value SOVEREIGN_CODING_MODEL)"
vision_model="$(env_value SOVEREIGN_VISION_MODEL)"
embedding_model="$(env_value SOVEREIGN_EMBEDDING_MODEL)"
ollama_image="$(env_value OLLAMA_IMAGE)"
web_port="$(env_value WEB_PORT)"
[[ -n "$model" && -n "$coding_model" && -n "$vision_model" && -n "$embedding_model" ]] || {
  echo "Model names are missing from .env." >&2; exit 1;
}
ollama_image="${ollama_image:-ollama/ollama:latest}"
web_port="${web_port:-8080}"

docker compose --env-file "$env_file" config --quiet
docker compose --env-file "$env_file" build
docker compose --env-file "$env_file" pull mongo redis qdrant ollama
docker volume create cldx-sovereign_ollama-models >/dev/null

# The application network is offline. Download models using a temporary
# container on Docker's ordinary network, sharing only the model volume.
loader="cldx-sovereign-model-loader-$$"
cleanup() { docker rm -f "$loader" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker run -d --name "$loader" --network bridge \
  --mount type=volume,source=cldx-sovereign_ollama-models,target=/root/.ollama \
  "$ollama_image" serve >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "$loader" ollama list >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]] || { echo "Ollama did not start in the model loader." >&2; exit 1; }
for selected_model in "$model" "$coding_model" "$vision_model" "$embedding_model"; do
  echo "Downloading $selected_model to this computer..."
  docker exec "$loader" ollama pull "$selected_model"
done
cleanup
trap - EXIT

docker compose --env-file "$env_file" up -d
services_ready=false
for _ in $(seq 1 45); do
  if docker compose --env-file "$env_file" exec -T app node -e \
      'fetch("http://127.0.0.1:8000/").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' >/dev/null 2>&1 \
    && docker compose --env-file "$env_file" exec -T agent node -e \
      'fetch("http://127.0.0.1:8003/").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' >/dev/null 2>&1; then
    services_ready=true
    break
  fi
  sleep 2
done
[[ "$services_ready" == true ]] || { echo "CLDX services did not become healthy. Check docker compose logs." >&2; exit 1; }
./verify-containment.sh
echo "Sovereign Mode is ready at http://127.0.0.1:$web_port"
echo "Sign in as admin with the password you created on this computer."
