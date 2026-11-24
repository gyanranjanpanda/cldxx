#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
project="cldx-sovereign"
failed=0

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failed=1; }

if [ "$(docker network inspect -f '{{.Internal}}' "${project}_internal" 2>/dev/null)" = true ]; then
  pass "application network is internal"
else
  fail "application network is not internal"
fi

if [ "$(docker network inspect -f '{{.Internal}}' "${project}_ingress" 2>/dev/null)" = false ]; then
  pass "web ingress bridge exists"
else
  fail "web ingress bridge is unavailable"
fi

for service in app agent mongo redis qdrant ollama web; do
  if [ -n "$(docker compose ps --status running -q "$service")" ]; then
    pass "$service is running"
  else
    fail "$service is not running"
  fi
done

# Node is installed in both application images. Any HTTP response means the
# container reached the destination, regardless of the response status.
for service in app agent; do
  if ! docker compose exec -T "$service" node --version >/dev/null 2>&1; then
    fail "$service cannot run the network probe"
    continue
  fi
  if docker compose exec -T "$service" node -e '
    fetch("http://1.1.1.1/", { signal: AbortSignal.timeout(6000) })
      .then(() => process.exit(0), () => process.exit(1));
  ' >/dev/null 2>&1; then
    fail "$service reached the internet"
  else
    pass "$service could not reach the internet"
  fi
done

for service in app agent mongo redis qdrant ollama; do
  container="$(docker compose ps -q "$service")"
  if [ -n "$container" ] && [ -z "$(docker inspect -f '{{if index .NetworkSettings.Networks "cldx-sovereign_ingress"}}attached{{end}}' "$container" 2>/dev/null)" ]; then
    pass "$service is isolated from ingress"
  else
    fail "$service joined the ingress bridge"
  fi
  if docker compose ps "$service" --format '{{.Publishers}}' | grep -Eq '[0-9]+:[0-9]+'; then
    fail "$service publishes a host port"
  else
    pass "$service has no published host port"
  fi
done

case "$(docker compose port web 80 2>/dev/null)" in
  127.0.0.1:*) pass "web port binds to loopback" ;;
  *) fail "web port is not bound to loopback" ;;
esac

exit "$failed"
