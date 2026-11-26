#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "$0")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
mkdir -p "$tmpdir/deploy" "$tmpdir/bin"
cp -R "$source_dir" "$tmpdir/deploy/sovereign"

cat > "$tmpdir/bin/docker" <<'EOF'
#!/usr/bin/env bash
python3 "$CLDX_MOCK_DOCKER" "$@"
EOF
chmod +x "$tmpdir/bin/docker"
export CLDX_MOCK_DOCKER="$source_dir/tests/docker_mock.py"
export PATH="$tmpdir/bin:$PATH"

printf 'eight123\n' |
  bash "$tmpdir/deploy/sovereign/install.sh" > "$tmpdir/first.log" 2>&1
env_file="$tmpdir/deploy/sovereign/.env"
grep -q '^SOVEREIGN_MODEL=qwen2.5:1.5b$' "$env_file"
grep -q '^FRONTEND_URL=http://127.0.0.1:8080$' "$env_file"
grep -q '^INTERNAL_API_KEY=[a-f0-9]\{64\}$' "$env_file"
grep -q 'Sovereign Mode is ready at http://127.0.0.1:8080' "$tmpdir/first.log"
if grep -q 'eight123' "$tmpdir/first.log"; then
  echo 'Password leaked to installer output' >&2
  exit 1
fi

cp "$env_file" "$tmpdir/original.env"
bash "$tmpdir/deploy/sovereign/install.sh" < /dev/null > "$tmpdir/second.log" 2>&1
cmp "$tmpdir/original.env" "$env_file"
grep -q 'Using the existing .env' "$tmpdir/second.log"
echo 'Unix installer fresh/resume smoke test passed'
