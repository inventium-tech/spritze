#!/bin/sh
# Cross-runtime smoke harness for the published package.
#
# Stages the packed dist/ + package.json exactly as they will be published,
# builds a minimal ESM consumer that resolves the bare specifier
# `@inventium-tech/spritze` through a local node_modules directory, then runs
# tests/runtime/consumer.mjs unmodified under bun, node, and deno.
#
# Assumes `bun run prepack` has already produced dist/index.js and
# dist/index.d.ts (see the `test:runtime` package script).
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

if [ ! -f dist/index.js ] || [ ! -f dist/index.d.ts ]; then
  echo "test-runtime: missing dist/index.js or dist/index.d.ts; run 'bun run prepack' first" >&2
  exit 1
fi

tmp_dir=$(mktemp -d)
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

pkg_dir="$tmp_dir/package"
mkdir -p "$pkg_dir"
cp package.json "$pkg_dir/package.json"
cp -R dist "$pkg_dir/dist"

consumer_dir="$tmp_dir/consumer"
scope_dir="$consumer_dir/node_modules/@inventium-tech"
mkdir -p "$scope_dir"
cp -R "$pkg_dir" "$scope_dir/spritze"

cat > "$consumer_dir/package.json" <<'EOF'
{
  "name": "spritze-runtime-smoke-consumer",
  "private": true,
  "type": "module",
  "dependencies": {
    "@inventium-tech/spritze": "*"
  }
}
EOF

cp tests/runtime/consumer.mjs "$consumer_dir/consumer.mjs"

echo "test-runtime: running under bun"
(cd "$consumer_dir" && bun run consumer.mjs)

echo "test-runtime: running under node"
(cd "$consumer_dir" && node consumer.mjs)

echo "test-runtime: running under deno"
(cd "$consumer_dir" && deno run --no-prompt --allow-read --node-modules-dir=manual consumer.mjs)

echo "test-runtime: all runtimes passed"
