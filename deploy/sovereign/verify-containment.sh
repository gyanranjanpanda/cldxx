#!/usr/bin/env bash
#
# Proves the boundary from outside the application. Run this in front of a
# security team: the interesting result is not that sovereign turns go to the
# local model, it is that the containers cannot reach the internet even when
# they try.
#
#   ./verify-containment.sh
#
# Every check runs INSIDE a container, against real destinations, using the
# container's own network stack. Nothing here trusts application code.

set -uo pipefail

COMPOSE="docker compose -f $(dirname "$0")/docker-compose.yml"
pass=0; fail=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Reaching a host directly must fail: containers on `internal` have no route.
# --max-time keeps a silently-dropped packet from hanging the check.
probe_direct() {
  local svc=$1 host=$2
  if $COMPOSE exec -T "$svc" sh -c \
      "curl -s --max-time 8 --noproxy '*' -o /dev/null https://$host" 2>/dev/null; then
    bad "$svc reached $host directly — the internal network has a route out"
  else
    ok  "$svc cannot reach $host directly"
  fi
}

# Through the proxy, a destination that is not on the allowlist must be refused.
probe_proxied() {
  local svc=$1 host=$2 expect=$3
  local code
  code=$($COMPOSE exec -T "$svc" sh -c \
    "curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
     -x http://egress-proxy:3128 https://$host" 2>/dev/null || echo "000")

  if [ "$expect" = "allow" ]; then
    [ "$code" = "000" ] && bad "$host is allowlisted but unreachable through the proxy" \
                        || ok  "$host reachable through the proxy (HTTP $code)"
  else
    case "$code" in
      403|407|000) ok  "$host refused by the proxy (HTTP $code)" ;;
      *)           bad "$host was NOT refused — proxy returned HTTP $code" ;;
    esac
  fi
}

head "Containers are running"
if ! $COMPOSE ps --status running --quiet | grep -q .; then
  echo "  stack is not up — run: $COMPOSE up -d"
  exit 1
fi
ok "stack is up"

head "No route off the internal network (the boundary itself)"
for svc in agent app; do
  for host in api.openai.com google.com registry.npmjs.org; do
    probe_direct "$svc" "$host"
  done
done

head "Backing services are unreachable from outside the internal network"
for svc in mongo redis qdrant ollama; do
  if docker run --rm --network cldx-sovereign_egress alpine/curl:latest \
       sh -c "curl -s --max-time 5 -o /dev/null http://$svc" 2>/dev/null; then
    bad "$svc is reachable from the egress network"
  else
    ok  "$svc is not reachable from the egress network"
  fi
done

head "The proxy denies by default"
probe_proxied agent evil.example.com     deny
probe_proxied agent cdn.jsdelivr.net     deny
probe_proxied agent fonts.googleapis.com deny

head "The proxy allows what the allowlist names"
probe_proxied agent api.github.com allow

head "Only one port is published to the host"
published=$($COMPOSE ps --format '{{.Publishers}}' 2>/dev/null | grep -o '0.0.0.0:[0-9]*' | sort -u | wc -l | tr -d ' ')
[ "$published" -le 1 ] && ok "exactly $published published port" \
                       || bad "$published published ports — a sovereign install should publish only the web port"

head "Sovereign Mode inside the container"
if $COMPOSE exec -T agent sh -c \
     "SOVEREIGN_BASE_URL= node scripts/verifySovereign.js" >/dev/null 2>&1; then
  ok "fails closed with no runtime configured"
else
  bad "fail-closed check did not pass"
fi

printf '\n'
[ "$fail" -eq 0 ] && printf '\033[32mAll %d checks passed.\033[0m\n\n' "$pass" \
                  || printf '\033[31m%d of %d checks failed.\033[0m\n\n' "$fail" "$((pass+fail))"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
