#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
repo_root="$(cd ../.. && pwd)"
env_file="$PWD/.env"

[[ -t 0 ]] || { echo "Run this command in an interactive terminal." >&2; exit 1; }
[[ -f "$env_file" ]] || { echo "No local account found. Run ./install.sh first." >&2; exit 1; }
grep -q '^LOCAL_AUTH_PASSWORD_HASH=' "$env_file" || {
  echo "LOCAL_AUTH_PASSWORD_HASH is missing from .env." >&2; exit 1;
}
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Start Docker Desktop, then retry." >&2; exit 1; }

printf 'New password (at least 8 characters): '
IFS= read -rs new_password
printf '\n'
printf 'Confirm new password: '
IFS= read -rs confirmation
printf '\n'

if [[ ${#new_password} -lt 8 || "$new_password" != "$confirmation" ]]; then
  echo "Passwords must match and contain at least 8 characters." >&2
  exit 1
fi
unset confirmation

export LOCAL_AUTH_NEW_PASSWORD="$new_password"
unset new_password
password_hash="$(docker run --rm --network none --env LOCAL_AUTH_NEW_PASSWORD \
  --mount "type=bind,source=$repo_root/backend/app,target=/app,readonly" \
  --workdir /app node:22-slim node scripts/hash-local-password.mjs)"
unset LOCAL_AUTH_NEW_PASSWORD
[[ "$password_hash" =~ ^[a-f0-9]{32}:[a-f0-9]{128}$ ]] || {
  echo "Could not create the password hash." >&2; exit 1;
}

umask 077
temporary_env="$(mktemp "$env_file.tmp.XXXXXX")"
trap 'rm -f "$temporary_env"' EXIT
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    LOCAL_AUTH_PASSWORD_HASH=*) printf 'LOCAL_AUTH_PASSWORD_HASH=%s\n' "$password_hash" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$env_file" > "$temporary_env"
chmod 600 "$temporary_env"
mv -f "$temporary_env" "$env_file"
trap - EXIT
unset password_hash

docker compose --env-file "$env_file" up -d --no-deps --force-recreate app
echo "Password updated. Sign in as admin at http://127.0.0.1:8080."
