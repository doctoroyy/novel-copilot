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

export type ServerEvent = LogEvent | ProgressEvent;

interface UseServerEventsOptions {
  onLog?: (event: LogEvent) => void;
  onProgress?: (event: ProgressEvent) => void;
  enabled?: boolean;
}

export function useServerEvents({ onLog, onProgress, enabled = true }: UseServerEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enabledRef = useRef(enabled);
  const onLogRef = useRef(onLog);
  const onProgressRef = useRef(onProgress);
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

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    // EventSource doesn't support custom headers, so pass token via query param
    const token = getToken();
    const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connection established');
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;
        
        if (data.type === 'log' && onLogRef.current) {
          onLogRef.current(data);
        } else if (data.type === 'progress' && onProgressRef.current) {
          onProgressRef.current(data);
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      console.log('SSE connection lost, reconnecting...');
      setConnected(false);
      eventSource.close();
      if (!enabledRef.current) return;
      // Reconnect after 3 seconds
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
