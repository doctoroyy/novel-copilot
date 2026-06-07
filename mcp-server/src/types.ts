/**
 * Shared type declarations for the MCP server.
 */

export interface AIConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

