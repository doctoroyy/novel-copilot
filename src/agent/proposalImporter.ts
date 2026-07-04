import { z } from 'zod';
import { ToolSchemas } from './tools.js';

export const ProposalSchema = ToolSchemas.submit_proposal;

export type ProposalData = z.infer<typeof ProposalSchema>;

export interface ProposalImportResult {
  success: boolean;
  data?: ProposalData;
  error?: string;
}

/**
 * Parses and validates a proposal payload returned by the Agent.
 * @param payload The raw JSON arguments of the submit_proposal tool call.
 */
export function importProposal(payload: any): ProposalImportResult {
  try {
    let parsed = payload;
    if (typeof payload === 'string') {
      parsed = JSON.parse(payload);
    }
    const data = ProposalSchema.parse(parsed);
    return {
      success: true,
      data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Calculates the rough differences or changes (can be used for UI diff preview).
 * In a real desktop implementation, we'd use something like diff-match-patch or jsdiff.
 */
export function generateProposalDiff(originalText: string, newText: string): any {
  // Mock implementation for the spike
  return {
    originalLength: originalText.length,
    newLength: newText.length,
    delta: newText.length - originalText.length,
  };
}
