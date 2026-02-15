# Novel Copilot

AI long-form novel creation platform with Web + React Native App clients, powered by Cloudflare Workers.

[中文说明](./README.zh.md)

## Highlights

- Web + App experience for project management, outline, chapter generation, and reading
- Persistent background generation tasks (`generation_tasks`) with task center synchronization
- SSE-powered generation flows and server events
- Context engineering + QC pipeline for long-story consistency
- Cloudflare stack: Workers + D1 + R2

## Product Screenshots

### Web Home (Dashboard)

![Web Home Dashboard](./docs/images/web-home-dashboard.png)

### App Home (Project List)

![App Home Project List](./docs/images/app-home-project-list.png)

### App Project Home

![App Project Home](./docs/images/app-project-home.png)

### App Chapter Content

![App Chapter Content](./docs/images/app-chapter-content.png)

## Tech Stack

- Backend: Hono, Cloudflare Workers, D1, R2, TypeScript
- Web: React 19, Vite, TailwindCSS 4, Radix UI
- App: Expo 54, React Native 0.81, React Navigation

## Repository Structure

```text
novel-copilot/
├── src/                    # Worker backend
├── web/                    # Web frontend
├── mobile/                 # Expo mobile app
├── migrations/             # D1 migrations
├── scripts/                # Build/packaging scripts
├── docs/                   # Docs and screenshots
└── .github/workflows/      # CI workflows
```

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Cloudflare account (for deploy)

### Install

```bash
pnpm install
pnpm -C web install
pnpm -C mobile install
```

### Local DB

```bash
pnpm db:migrate:local
```

### Run Backend

```bash
pnpm dev
```

Backend: `http://localhost:8787`

### Run Web

```bash
pnpm -C web dev
```

Web: `http://localhost:5173`

### Run App

```bash
pnpm dev:mobile
```

## Key Scripts

```bash
# type check
pnpm typecheck
pnpm mobile:typecheck

# web build
pnpm build:web

# migrations
pnpm db:migrate:local
pnpm db:migrate:remote

# deploy
pnpm deploy

# iOS local packaging
pnpm mobile:ios:package
pnpm mobile:ios:package:install
```

## Mobile CI Packaging

Workflow:

- `.github/workflows/build-mobile-packages.yml`

Artifacts:

- `ios-ipa`
- `android-universal-apk`
- `android-arm64-apk`

iOS required repository secrets:

- `IOS_CERT_BASE64`
- `IOS_CERT_PASSWORD`
- `IOS_PROVISION_PROFILE_BASE64`
- `IOS_TEAM_ID`
- `IOS_KEYCHAIN_PASSWORD`

Optional:

- `IOS_BUNDLE_ID`
- `IOS_EXPORT_METHOD`
- `IOS_CODE_SIGN_IDENTITY`

Details: `./docs/mobile-ci.md`

## Deployment (Cloudflare)

```bash
# create D1
npx wrangler d1 create novel-copilot-db

# optional: create R2 for anime/video
npx wrangler r2 bucket create novel-copilot-videos

# initialize schema
pnpm db:init

# deploy
pnpm deploy
```

## Notes

- Web routing uses `projectId`: `/project/:projectId/...`
- Mobile navigation uses `projectId`
- Backend `projectRef` accepts both `id` and `name` for backward compatibility; new code should prefer `id`

## License

MIT
