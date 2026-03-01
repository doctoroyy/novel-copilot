import { useEffect, useRef, useCallback, useState } from 'react';
import { getToken } from '@/lib/auth';


export interface LogEvent {
  type: 'log';
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
  project?: string;
}

export interface ProgressEvent {
  type: 'progress';
  projectName: string;
  current: number;
  total: number;
  chapterIndex: number;
  chapterTitle?: string;
  status: 'starting' | 'analyzing' | 'planning' | 'generating' | 'reviewing' | 'repairing' | 'saving' | 'updating_summary' | 'done' | 'error';

  message?: string;
}

export type ServerEvent = LogEvent | ProgressEvent | TaskUpdateEvent;

// 任务状态变更信号事件
export interface TaskUpdateEvent {
  type: 'task_update';
}

interface UseServerEventsOptions {
  onLog?: (event: LogEvent) => void;
  onProgress?: (event: ProgressEvent) => void;
  onTaskUpdate?: () => void;
  enabled?: boolean;
}

export function useServerEvents({ onLog, onProgress, onTaskUpdate, enabled = true }: UseServerEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastEventIdRef = useRef(0);
  const enabledRef = useRef(enabled);
  const onLogRef = useRef(onLog);
  const onProgressRef = useRef(onProgress);
  const onTaskUpdateRef = useRef(onTaskUpdate);
  const connectRef = useRef<() => void>(() => {});

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onLogRef.current = onLog;
  }, [onLog]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    onTaskUpdateRef.current = onTaskUpdate;
  }, [onTaskUpdate]);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    const token = getToken();
    if (!token) {
      setConnected(false);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, 2000);
      return;
    }

    const params = new URLSearchParams({
      token,
      cursor: String(lastEventIdRef.current),
    });
    const url = `/api/events?${params.toString()}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connection established');
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent & { id?: number };
        if (typeof data.id === 'number' && Number.isFinite(data.id)) {
          lastEventIdRef.current = Math.max(lastEventIdRef.current, data.id);
        }

        if (data.type === 'log' && onLogRef.current) {
          onLogRef.current(data);
        } else if (data.type === 'progress' && onProgressRef.current) {
          onProgressRef.current(data);
        } else if (data.type === 'task_update' && onTaskUpdateRef.current) {
          onTaskUpdateRef.current();
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      console.log('SSE connection lost, reconnecting...');
      setConnected(false);
      eventSource.close();
      eventSourceRef.current = null;
      if (!enabledRef.current) return;
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, 3000);
    };

  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      return;
    }

    connectRef.current();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
    };
  }, [enabled]);

  return { connected: enabled ? connected : false };
}
