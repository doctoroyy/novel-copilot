#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_FILE="$ROOT_DIR/mobile/android/app/build.gradle"

if [[ ! -f "$BUILD_FILE" ]]; then
  echo "[error] Android build file not found: $BUILD_FILE" >&2
  exit 1
fi

if grep -q "ABI_SPLITS_ENABLED_BY_CI" "$BUILD_FILE"; then
  echo "[info] ABI splits already enabled"
  exit 0
fi

TMP_FILE="$(mktemp)"

awk '
BEGIN { inserted = 0 }
{
  print
  if (!inserted && $0 ~ /^android \{$/) {
    print ""
    print "    // ABI_SPLITS_ENABLED_BY_CI"
    print "    splits {"
    print "        abi {"
    print "            reset()"
    print "            enable true"
    print "            universalApk true"
    print "            include \"armeabi-v7a\", \"arm64-v8a\", \"x86\", \"x86_64\""
    print "        }"
    print "    }"
    inserted = 1
  }
}
END {
  if (!inserted) {
    print "[error] failed to locate android block in build.gradle" > "/dev/stderr"
    exit 1
  }
}
' "$BUILD_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$BUILD_FILE"
echo "[ok] enabled ABI splits in $BUILD_FILE"
