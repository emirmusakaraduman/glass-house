#!/usr/bin/env bash
# Windows'ta LiteSVM calismadigi icin testleri WSL (Linux) icinde calistirir.
# Kaynak /mnt/c altindan ~/glasshouse-wsl'e esitlenir; node_modules Linux tarafinda ayri durur.
# Kullanim (PowerShell):  wsl -d Ubuntu -- bash /mnt/c/Users/testm/Desktop/GlassHouse/scripts/wsl-test.sh [mocha argumanlari]
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="$HOME/glasshouse-wsl"
mkdir -p "$DST"

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude 'target/debug' --exclude 'target/release' \
  --exclude 'target/sbpf*' --exclude .keys \
  "$SRC/" "$DST/"

cd "$DST"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
fi

if [ "$#" -gt 0 ]; then
  npx mocha -n no-experimental-strip-types -r ts-node/register -t 1000000 "$@"
else
  npm test
fi
