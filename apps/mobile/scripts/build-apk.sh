#!/usr/bin/env bash
# Build an installable Android APK locally (release build, signed with the debug key).
# Output: dist/open2talk-android.apk at the repo root.
#
# Needs the Android SDK (default ~/Library/Android/sdk) and JDK 17.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in /opt/homebrew/opt/openjdk@17 /usr/local/opt/openjdk@17; do
    [ -d "$jdk" ] && export JAVA_HOME="$jdk" && break
  done
fi
[ -d "$ANDROID_HOME" ] || { echo "Android SDK not found at $ANDROID_HOME (set ANDROID_HOME)." >&2; exit 1; }
[ -n "${JAVA_HOME:-}" ] || { echo "JDK 17 not found (set JAVA_HOME)." >&2; exit 1; }

# Regenerate the native project from app.json and the config plugins (never edited by hand).
npx expo prebuild --platform android --no-install

# 32-bit x86 is only used by old emulators; skipping it saves build time.
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="${ABIS:-arm64-v8a,armeabi-v7a,x86_64}")

mkdir -p "$ROOT/dist"
cp android/app/build/outputs/apk/release/app-release.apk "$ROOT/dist/open2talk-android.apk"
echo "APK: $ROOT/dist/open2talk-android.apk"
