#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/apps/mobile"
npx --no-install expo prebuild --clean --platform android --no-install
cd android

# Expo usa signingConfigs.debug no release gerado. Falhe se o template mudar;
# jamais sobrescreva silenciosamente uma configuração de assinatura de produção.
node "$ROOT_DIR/scripts/check-internal-signing.mjs"
if [ ! -f app/debug.keystore ]; then
  keytool -genkeypair -keystore app/debug.keystore -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 365 \
    -dname "CN=Consta Internal Development,O=Consta,C=BR" -noprompt
fi
bash ./gradlew assembleRelease --no-daemon --max-workers=2 \
  "-PreactNativeArchitectures=${ANDROID_ABIS:-arm64-v8a}" \
  '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g'
mkdir -p "$ROOT_DIR/artifacts/android"
cp app/build/outputs/apk/release/app-release.apk "$ROOT_DIR/artifacts/android/consta-internal.apk"
cd "$ROOT_DIR/artifacts/android"
sha256sum consta-internal.apk > SHA256SUMS.txt
keytool -list -v -keystore "$ROOT_DIR/apps/mobile/android/app/debug.keystore" \
  -alias androiddebugkey -storepass android > signing-certificate.txt
printf '%s\n' \
  'Consta: APK release para TESTE INTERNO. Assinatura de desenvolvimento, não Google Play.' \
  "ABIs: ${ANDROID_ABIS:-arm64-v8a}" \
  'Sem IDs OAuth/API configurados, login informa configuração pendente; não existe login falso.' \
  'Não inclui chave privada. O certificado desta execução pode mudar numa próxima execução.' \
  > INSTALL.txt
