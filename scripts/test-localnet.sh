#!/usr/bin/env bash
# Yerel doğrulayıcı gerektiren entegrasyon testleri (tests/localnet/*.ts, Kişi 1).
# LiteSVM testlerinden (npm test) ayrıdır: gerçek solana-test-validator başlatır, programı yükler,
# testleri koşturur ve doğrulayıcıyı kapatır. Önce `npm run build` ile program derlenmiş olmalı.
#   GLASSHOUSE_SO=/yol/glasshouse.so npm run test:localnet   (başka bir binary'yi denemek için)
set -euo pipefail
cd "$(dirname "$0")/.."

PROGRAM_ID="HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2"
SO="${GLASSHOUSE_SO:-target/deploy/glasshouse.so}"
[ -f "$SO" ] || { echo "Program bulunamadı: $SO (önce: npm run build)"; exit 1; }
[ -f target/idl/glasshouse.json ] || { echo "IDL yok: target/idl/glasshouse.json (önce: npm run build)"; exit 1; }

LEDGER="$(mktemp -d)"
solana-test-validator --reset --quiet --ledger "$LEDGER" --bpf-program "$PROGRAM_ID" "$SO" >/dev/null 2>&1 &
VALIDATOR_PID=$!
trap 'kill $VALIDATOR_PID 2>/dev/null || true; rm -rf "$LEDGER"' EXIT

for _ in $(seq 1 60); do
  curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://127.0.0.1:8899 2>/dev/null | grep -q '"ok"' && break
  sleep 1
done

export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
npx ts-mocha -p ./tsconfig.json -t 1000000 "tests/localnet/**/*.ts"
