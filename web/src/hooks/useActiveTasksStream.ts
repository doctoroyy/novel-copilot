import { useEffect, useRef, useState } from 'react';

import type { GenerationTask } from '@/lib/api';
import { getToken } from '@/lib/auth';

type ActiveTasksStreamPayload = {
  type: 'active_tasks';
  tasks: GenerationTask[];
};

type UseActiveTasksStreamResult = {
  tasks: GenerationTask[];
  connected: boolean;
};

export function useActiveTasksStream(enabled = true): UseActiveTasksStreamResult {
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    let connect = () => {};

    const closeCurrent = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
    };

    const scheduleReconnect = (delayMs: number) => {
      if (!enabledRef.current) return;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delayMs);
    };

    connect = () => {
      if (!enabledRef.current) return;

      closeCurrent();

      const token = getToken();
      if (!token) {
        setTasks([]);
        scheduleReconnect(2000);
        return;
      }

      const params = new URLSearchParams({
        stream: '1',
        token,
      });
      const eventSource = new EventSource(`/api/active-tasks?${params.toString()}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ActiveTasksStreamPayload;
          if (payload.type === 'active_tasks' && Array.isArray(payload.tasks)) {
            setTasks(payload.tasks);
          }
        } catch (error) {
          console.error('Failed to parse active-tasks stream payload:', error);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
        setConnected(false);
        scheduleReconnect(3000);
      };
    };

    if (!enabled) {
      setTasks([]);
      setConnected(false);
      closeCurrent();
      return;
    }

    connect();

    return () => {
      closeCurrent();
    };
  }, [enabled]);

  return { tasks, connected: enabled ? connected : false };
}
