# Mobile Packaging CI

This repository includes GitHub Actions workflow:

- `.github/workflows/build-mobile-packages.yml`

It builds and publishes:

- iOS IPA: `NovelCopilot-ios.ipa`
- Android universal APK: `NovelCopilot-android-universal.apk`
- Android arm64 APK: `NovelCopilot-android-arm64-v8a.apk`

## Trigger

- Push to `main` (when files under `mobile/`, `scripts/`, `package.json`, or workflow file change)
- Manual run from GitHub Actions (`workflow_dispatch`)

## Outputs

### Workflow artifacts

- `NovelCopilot-ios-ipa`
- `NovelCopilot-android-universal-apk`
- `NovelCopilot-android-arm64-apk`

### GitHub Release assets (auto-published)

Workflow updates a rolling pre-release:

- Tag: `mobile-builds`
- Release name: `NovelCopilot Mobile Builds`

Assets are overwritten by latest successful run so the release always points to the newest build files.

## Required iOS Secrets

Set these repository secrets before enabling iOS build:

- `IOS_CERT_BASE64`: Base64 encoded `.p12` certificate
- `IOS_CERT_PASSWORD`: Password for the `.p12` file
- `IOS_PROVISION_PROFILE_BASE64`: Base64 encoded `.mobileprovision`
- `IOS_TEAM_ID`: Apple Team ID
- `IOS_KEYCHAIN_PASSWORD`: Temporary keychain password used in CI

Optional iOS secrets:

- `IOS_BUNDLE_ID` (default: `com.xiaoyu.novelcopilot.mobile`)
- `IOS_EXPORT_METHOD` (default: `ad-hoc`)
- `IOS_CODE_SIGN_IDENTITY` (default: `Apple Distribution`)

If required secrets are not set, Android build still runs and iOS build is skipped.

## Local iOS Packaging Commands

- `pnpm mobile:ios:package`
- `pnpm mobile:ios:package:install`
