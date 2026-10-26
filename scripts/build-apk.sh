#!/usr/bin/env bash
# Build a signed release APK into dist/.
#   HERMES_KEYSTORE=~/.hermes-android/release.keystore HERMES_KEYSTORE_PASSWORD=... scripts/build-apk.sh
# Without HERMES_KEYSTORE the APK is signed with the debug key.
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk}
ABIS=${ABIS:-arm64-v8a,armeabi-v7a}
VERSION=$(node -p "require('./app.json').expo.version")

if [[ ${SKIP_PREBUILD:-0} != 1 ]]; then
  CI=1 npx expo prebuild --platform android --clean
fi

(
  cd android

  # Foreground-service ordering is a runtime property, not a source shape: "promoted before
  # stopping" and "stopped before promoting" contain the same calls in the same file. These
  # Robolectric tests execute the real service, so a reordering fails the build instead of
  # slipping past a grep.
  ./gradlew :hermes-keepalive:testReleaseUnitTest \
    -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" \
    --no-daemon

  ./gradlew assembleRelease \
    -PreactNativeArchitectures="$ABIS" \
    -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" \
    --no-daemon
)

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "dist/hermes-android-v${VERSION}.apk"
echo "built dist/hermes-android-v${VERSION}.apk"
