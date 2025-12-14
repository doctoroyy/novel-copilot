import { useEffect, useRef, useCallback } from 'react';

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
  status: 'starting' | 'generating' | 'saving' | 'updating_summary' | 'done' | 'error';
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

  const connect = useCallback(() => {
    if (!enabled) return;
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/events');
    eventSourceRef.current = eventSource;

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
      eventSource.close();
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    eventSource.onopen = () => {
      console.log('SSE connection established');
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
}
