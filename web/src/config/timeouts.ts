/**
 * Centralized timeout configuration for the frontend application
 * 
 * Note: These timeouts cannot be configured in wrangler.toml as Cloudflare Workers
 * does not support HTTP request timeout configuration at the platform level.
 * Timeouts must be implemented using AbortController in the code.
 * 
 * This configuration is shared between frontend and backend, but kept separate
 * for frontend to avoid coupling with backend code.
 */

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  /**
   * Default timeout for normal API operations (1 minute)
   * Used for: fetching projects, chapters, etc.
   */
  DEFAULT: 60000,

  /**
   * Timeout for AI generation operations (10 minutes)
   * Used for: generating outlines, chapters, bible
   * Longer than backend timeout to allow for retries and network overhead
   */
  GENERATION: 600000,

  /**
   * Timeout for testing AI connections (30 seconds)
   * Used for: validating API keys and connectivity
   */
  TEST_CONNECTION: 30000,
} as const;

/**
 * Helper to get timeout in seconds (for display purposes)
 */
export function getTimeoutInSeconds(timeout: number): number {
  return Math.round(timeout / 1000);
}

/**
 * Helper to get timeout in minutes (for display purposes)
 */
export function getTimeoutInMinutes(timeout: number): number {
  return Math.round(timeout / 60000);
}
