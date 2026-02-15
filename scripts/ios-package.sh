#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"
IOS_DIR="$MOBILE_DIR/ios"

TEAM_ID="${TEAM_ID:-227UGFU7Z8}"
BUNDLE_ID="${BUNDLE_ID:-com.xiaoyu.novelcopilot.mobile}"
SCHEME="${SCHEME:-NovelCopilot}"
WORKSPACE_PATH="$IOS_DIR/${SCHEME}.xcworkspace"
CONFIGURATION="${CONFIGURATION:-Release}"
METHOD="${METHOD:-debugging}"
DEVICE_ID="${DEVICE_ID:-}"
SIGNING_STYLE="${SIGNING_STYLE:-automatic}" # automatic | manual
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:-Apple Development}"
PROVISIONING_PROFILE_SPECIFIER="${PROVISIONING_PROFILE_SPECIFIER:-}"

DO_INSTALL="false"
for arg in "$@"; do
  case "$arg" in
    --install)
      DO_INSTALL="true"
      ;;
    *)
      echo "[error] unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$MOBILE_DIR" ]]; then
  echo "[error] mobile project not found: $MOBILE_DIR" >&2
  exit 1
fi

if [[ ! -d "$WORKSPACE_PATH" ]]; then
  echo "[error] iOS workspace not found: $WORKSPACE_PATH" >&2
  exit 1
fi

if [[ "$SIGNING_STYLE" != "automatic" && "$SIGNING_STYLE" != "manual" ]]; then
  echo "[error] SIGNING_STYLE must be automatic or manual, got: $SIGNING_STYLE" >&2
  exit 1
fi

if [[ "$SIGNING_STYLE" == "manual" && -z "$PROVISIONING_PROFILE_SPECIFIER" ]]; then
  echo "[error] PROVISIONING_PROFILE_SPECIFIER is required when SIGNING_STYLE=manual" >&2
  exit 1
fi

if [[ "$SIGNING_STYLE" == "automatic" ]]; then
  XCODE_SIGN_STYLE="Automatic"
else
  XCODE_SIGN_STYLE="Manual"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_PATH="/tmp/${SCHEME}-${STAMP}.xcarchive"
EXPORT_DIR="/tmp/${SCHEME}-export-${STAMP}"
EXPORT_OPTIONS_PATH="/tmp/${SCHEME}-export-options-${STAMP}.plist"

cat > "$EXPORT_OPTIONS_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${METHOD}</string>
  <key>signingStyle</key>
  <string>${SIGNING_STYLE}</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
EOF

if [[ "$SIGNING_STYLE" == "manual" ]]; then
  /usr/libexec/PlistBuddy -c "Add :provisioningProfiles dict" "$EXPORT_OPTIONS_PATH"
  /usr/libexec/PlistBuddy -c "Add :provisioningProfiles:${BUNDLE_ID} string ${PROVISIONING_PROFILE_SPECIFIER}" "$EXPORT_OPTIONS_PATH"
fi

echo "[info] archive with team=${TEAM_ID}, bundle=${BUNDLE_ID}, signing=${SIGNING_STYLE}"
ARCHIVE_ARGS=(
  -workspace "$WORKSPACE_PATH"
  -scheme "$SCHEME"
  -configuration "$CONFIGURATION"
  -destination "generic/platform=iOS"
  -archivePath "$ARCHIVE_PATH"
  -allowProvisioningUpdates
  DEVELOPMENT_TEAM="$TEAM_ID"
  CODE_SIGN_STYLE="$XCODE_SIGN_STYLE"
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"
  clean archive
)

if [[ -n "$CODE_SIGN_IDENTITY" ]]; then
  ARCHIVE_ARGS+=(CODE_SIGN_IDENTITY="$CODE_SIGN_IDENTITY")
fi

if [[ "$SIGNING_STYLE" == "manual" ]]; then
  ARCHIVE_ARGS+=(PROVISIONING_PROFILE_SPECIFIER="$PROVISIONING_PROFILE_SPECIFIER")
fi

xcodebuild "${ARCHIVE_ARGS[@]}"

echo "[info] export ipa"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PATH" \
  -allowProvisioningUpdates

IPA_PATH="$EXPORT_DIR/${SCHEME}.ipa"
if [[ ! -f "$IPA_PATH" ]]; then
  echo "[error] ipa not found: $IPA_PATH" >&2
  exit 1
fi

echo "[ok] ipa: $IPA_PATH"

if [[ "$DO_INSTALL" != "true" ]]; then
  exit 0
fi

if [[ -z "$DEVICE_ID" ]]; then
  if command -v jq >/dev/null 2>&1; then
    DEVICES_JSON_PATH="$(mktemp /tmp/devicectl-devices.XXXXXX)"
    xcrun devicectl list devices --json-output "$DEVICES_JSON_PATH" >/dev/null
    DEVICE_ID="$(
      jq -r '
        .result.devices
        | map(
            select(
              (.hardwareProperties.productType // "" | startswith("iPhone"))
              and (.connectionProperties.pairingState // "" == "paired")
              and (
                (.connectionProperties.transportType // "") == "wired"
                or (.deviceProperties.bootState // "") == "booted"
              )
            )
          )
        | .[0].identifier // empty
      ' "$DEVICES_JSON_PATH"
    )"
    rm -f "$DEVICES_JSON_PATH"
  fi
fi

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(
    xcrun devicectl list devices --hide-headers \
      | awk '($0 ~ /iPhone/ && $0 ~ /connected/) {print $3; exit}'
  )"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "[error] no device id found. set DEVICE_ID=<udid> and retry." >&2
  exit 1
fi

echo "[info] install to device: $DEVICE_ID"
xcrun devicectl device uninstall app --device "$DEVICE_ID" "$BUNDLE_ID" || true
xcrun devicectl device install app --device "$DEVICE_ID" "$IPA_PATH"
echo "[ok] installed: $BUNDLE_ID"
