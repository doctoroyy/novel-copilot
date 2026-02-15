import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationTask } from '../types/domain';
import { fetchActiveTasks } from '../lib/api';

export function useActiveTasks(params: {
  apiBaseUrl: string;
  token: string | null;
  enabled?: boolean;
  pollIntervalMs?: number;
}) {
  const { apiBaseUrl, token, enabled = true, pollIntervalMs = 8000 } = params;
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!token || !enabled) {
      setTasks([]);
      return;
    }

    try {
      setLoading(true);
      const result = await fetchActiveTasks(apiBaseUrl, token);
      setTasks(result);
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
    loading,
    error,
    refresh: load,
  };
}
