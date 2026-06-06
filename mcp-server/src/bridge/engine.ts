/**
 * Engine bridge — thin wrappers that call into the core novel-copilot engine.
 * Isolates MCP tool handlers from direct engine imports (for future decoupling).
 */

export { getDb } from './db.js';

// Future: re-export chapter generation, QC evaluation, etc.
// For now, tool handlers directly query SQLite.
