# Timeout Configuration

## Overview

This directory contains centralized timeout configuration for the application.

## Why Centralized Configuration?

While Cloudflare Workers (`wrangler.toml`) does not support configuring HTTP request timeouts at the platform level, we've centralized timeout values in code to:

1. **Single Source of Truth**: All timeout values are defined in one place
2. **Easy Maintenance**: Change timeout values without searching through multiple files
3. **Consistency**: Same timeout values are used across frontend and backend
4. **Documentation**: Clear comments explain each timeout's purpose

## Configuration Files

- **Backend**: `src/config/timeouts.ts` - Used by backend Worker code
- **Frontend**: `web/src/config/timeouts.ts` - Used by frontend application

## Timeout Values

| Constant | Value | Purpose |
|----------|-------|---------|
| `TIMEOUTS.DEFAULT` | 60s (1 minute) | Normal API operations (fetch projects, chapters) |
| `TIMEOUTS.GENERATION` | 600s (10 minutes) | AI generation operations (frontend) |
| `TIMEOUTS.AI_REQUEST` | 300s (5 minutes) | External AI API calls (backend only) |
| `TIMEOUTS.TEST_CONNECTION` | 30s | Testing API connections |

## Why Can't We Use `wrangler.toml`?

Cloudflare Workers configuration file (`wrangler.toml`) controls:
- Worker name and entry point
- Bindings (D1, KV, R2, Durable Objects)
- Environment variables
- Build commands
- CPU time limits (not wall-clock time)

It **cannot** control:
- HTTP request timeouts (requires AbortController in code)
- External API call timeouts (requires AbortController in code)
- fetch() operation timeouts (requires AbortController in code)

## Implementation

All timeouts use the `AbortController` API:

```typescript
import { TIMEOUTS } from './config/timeouts';

const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.AI_REQUEST);

try {
  const response = await fetch(url, {
    signal: controller.signal,
  });
  // ... handle response
} finally {
  clearTimeout(timeoutId);
}
```

## Changing Timeout Values

To modify timeout values:

1. Edit `src/config/timeouts.ts` (backend)
2. Edit `web/src/config/timeouts.ts` (frontend)
3. Redeploy the application

**Note**: Keep frontend timeouts ≥ backend timeouts to allow for retries and network overhead.

## Cloudflare Workers Limits

- **Free tier**: 10ms CPU time limit
- **Paid tier (Bundled)**: 30s CPU time limit
- **Paid tier (Unbound)**: 15 minutes CPU time limit

Our timeouts (5-10 minutes) are well within the Unbound Worker limits.
