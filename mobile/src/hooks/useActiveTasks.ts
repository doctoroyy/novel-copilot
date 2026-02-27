import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationTask } from '../types/domain';
import { fetchActiveTasks, fetchTaskHistory } from '../lib/api';

export function useActiveTasks(params: {
  apiBaseUrl: string;
  token: string | null;
  enabled?: boolean;
  pollIntervalMs?: number;
}) {
  const { apiBaseUrl, token, enabled = true, pollIntervalMs = 8000 } = params;
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [history, setHistory] = useState<GenerationTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!token || !enabled) {
      setTasks([]);
      setHistory([]);
      return;
    }

    try {
      setLoading(true);
      // Parallel fetch for active tasks and history
      const [activeResult, historyResult] = await Promise.all([
        fetchActiveTasks(apiBaseUrl, token),
        fetchTaskHistory(apiBaseUrl, token),
      ]);
      setTasks(activeResult);
      setHistory(historyResult);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, enabled, token]);

  useEffect(() => {
    if (!enabled || !token) return;

    void load();

    timerRef.current = setInterval(() => {
      void load();
    }, pollIntervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, load, pollIntervalMs, token]);

  return {
    tasks,
    history,
    loading,
    error,
    refresh: load,
  };
}
