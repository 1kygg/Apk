#!/usr/bin/env bash
set -euo pipefail

# Build nativo release para teste interno; NÃO é assinatura de publicação.
# Requisitos: Node22, npm ci, Java17, Android SDK e licenças aceitas.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [ -f .env ]; then
  # O helper Node carrega .env sem executar conteúdo como shell.
  exec node scripts/with-env.mjs --exec bash scripts/build-android-internal.sh
fi
exec bash scripts/build-android-internal.sh
