import { useEffect, useRef, useCallback, useState } from 'react';


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

  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!enabled) return;
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/events');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connection established');
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;
        
        if (data.type === 'log' && onLog) {
          onLog(data);
        } else if (data.type === 'progress' && onProgress) {
          onProgress(data);
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      console.log('SSE connection lost, reconnecting...');
      setConnected(false);
      eventSource.close();
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

  }, [enabled, onLog, onProgress]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return { connected };
}

