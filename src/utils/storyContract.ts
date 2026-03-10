import type { StoryContract, StoryContractField, StoryContractSection } from '../types/narrative.js';

function stringifyField(value: StoryContractField): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join('、');
  }
  return String(value);
}

function formatSection(title: string, section?: StoryContractSection): string[] {
  if (!section) return [];

  const entries = Object.entries(section)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `- ${key}: ${stringifyField(value as StoryContractField)}`);

  if (entries.length === 0) return [];
  return [`${title}:`, ...entries];
}

export function formatStoryContractForPrompt(contract?: StoryContract): string[] {
  if (!contract) return [];

  const lines = ['【章节合同】'];
  lines.push(...formatSection('scope', contract.scope));
  lines.push(...formatSection('crisis', contract.crisis));
  lines.push(...formatSection('threads', contract.threads));
  lines.push(...formatSection('stateTransition', contract.stateTransition));

  if (contract.notes?.length) {
    lines.push('notes:');
    lines.push(...contract.notes.map((note) => `- ${note}`));
  }

  return lines.length > 1 ? lines : [];
}

export function formatStoryContractForQc(contract?: StoryContract): string {
  const lines = formatStoryContractForPrompt(contract);
  return lines.length > 0 ? lines.join('\n') : '无';
}

export function hasStoryContract(contract?: StoryContract): boolean {
  if (!contract) return false;
  return Boolean(
    (contract.scope && Object.keys(contract.scope).length > 0) ||
    (contract.crisis && Object.keys(contract.crisis).length > 0) ||
    (contract.threads && Object.keys(contract.threads).length > 0) ||
    (contract.stateTransition && Object.keys(contract.stateTransition).length > 0) ||
    (contract.notes && contract.notes.length > 0)
  );
}
