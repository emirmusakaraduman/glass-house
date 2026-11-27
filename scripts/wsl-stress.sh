#!/usr/bin/env bash
# Runs the stress simulation inside WSL (Linux), because LiteSVM has no Windows build,
# and copies scripts/out/stress.json back to the Windows checkout.
# Usage (PowerShell):  wsl -d Ubuntu -- bash /mnt/c/Users/testm/Desktop/GlassHouse/scripts/wsl-stress.sh
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="$HOME/glasshouse-wsl"
mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude 'target/debug' --exclude 'target/release' \
  --exclude 'target/sbpf*' --exclude .keys --exclude 'scripts/out' \
  "$SRC/" "$DST/"

cd "$DST"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
fi
npx ts-node -P ./tsconfig.json scripts/stress.ts

mkdir -p "$SRC/scripts/out"
cp "$DST/scripts/out/stress.json" "$SRC/scripts/out/stress.json"
echo "written: $SRC/scripts/out/stress.json"
