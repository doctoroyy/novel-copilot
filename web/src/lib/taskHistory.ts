import type { TaskType } from '@/contexts/GenerationContext';

export interface TaskHistoryItem {
  id: string;
  type: TaskType;
  title: string;
  status: 'success' | 'error' | 'cancelled';
  startTime: number;
  endTime?: number;
  details?: string;
}

export const TASK_HISTORY_EVENT_NAME = 'taskHistoryUpdate';

// In-memory history (can be persisted later if needed)
let taskHistory: TaskHistoryItem[] = [];

export function addTaskToHistory(task: Omit<TaskHistoryItem, 'id'>): void {
  const id = `task-${Date.now()}`;
  taskHistory = [{ id, ...task }, ...taskHistory.slice(0, 19)];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TASK_HISTORY_EVENT_NAME));
  }
}

export function getTaskHistorySnapshot(): TaskHistoryItem[] {
  return [...taskHistory];
}
