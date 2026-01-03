import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

import { useServerEvents, type ProgressEvent } from '@/hooks/useServerEvents';

interface LogMessage {
  level: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  message: string;
}

interface ServerEventsContextType {
  connected: boolean;
  logs: string[];
  lastProgress: ProgressEvent | null;
  clearLogs: () => void;
}

const ServerEventsContext = createContext<ServerEventsContextType | undefined>(undefined);

export function ServerEventsProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [lastProgress, setLastProgress] = useState<ProgressEvent | null>(null);

  const { connected } = useServerEvents({
    onLog: useCallback((event: LogMessage) => {
      const prefixMap: Record<string, string> = {
        info: '📋',
        success: '✅',
        warning: '⚠️',
        error: '❌',
      };
      const prefix = prefixMap[event.level];
      setLogs((prev) => [...prev, `[${event.timestamp}] ${prefix} ${event.message}`]);
    }, []),
    
    onProgress: useCallback((event: ProgressEvent) => {
      setLastProgress(event);
      // Clear progress after done (optional, but good for UI cleanup)
      if (event.status === 'done' || event.status === 'error') {
        setTimeout(() => {
          setLastProgress(current => (current === event ? null : current));
        }, 3000);
      }
    }, []),
  });

  const clearLogs = useCallback(() => setLogs([]), []);

  return (
    <ServerEventsContext.Provider value={{ connected, logs, lastProgress, clearLogs }}>
      {children}
    </ServerEventsContext.Provider>
  );
}

export function useServerEventsContext() {
  const context = useContext(ServerEventsContext);
  if (context === undefined) {
    throw new Error('useServerEventsContext must be used within a ServerEventsProvider');
  }
  return context;
}
