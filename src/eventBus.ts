import { EventEmitter } from 'node:events';

// Event types
export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogEvent {
  type: 'log';
  level: LogLevel;
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

// Global event bus
class ServerEventBus extends EventEmitter {
  private queue: ServerEvent[] = [];

  constructor() {
    super();
    // Set max listeners to avoid warnings
    this.setMaxListeners(20);
  }

  log(level: LogLevel, message: string, project?: string) {
    const event: LogEvent = {
      type: 'log',
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
      project,
    };
    // Push to queue for polling consumers
    this.queue.push(event);
    
    // Still emit for local listeners (if any)
    this.emit('event', event);
    
    // Also log to console with appropriate prefix
    const prefix = {
      info: '📋',
      success: '✅',
      warning: '⚠️',
      error: '❌',
    }[level];
    console.log(`${prefix} ${message}`);
  }

  progress(data: Omit<ProgressEvent, 'type' | 'timestamp'>) {
    const event: ProgressEvent = {
      ...data,
      type: 'progress',
    };
    this.queue.push(event);
    this.emit('event', event);
  }

  // Consume events for a specific client (polling)
  // Limit to avoid sending too many at once
  consume(limit = 100): ServerEvent[] {
    if (this.queue.length === 0) return [];
    
    // In a multi-tenant/real env, this would need to filter by project/user
    // For this local single-user app, we can just splice the whole queue
    // But since there might be multiple SSE connections (reconnects), 
    // destructive consume is dangerous if multiple clients are connected.
    // However, for this app, we assume effectively one active client.
    // To be safe, we'll just return and clear.
    // Ideally we'd use IDs, but simplicity first for the I/O fix.
    const events = this.queue.splice(0, limit);
    return events;
  }

  info(message: string, project?: string) {
    this.log('info', message, project);
  }

  success(message: string, project?: string) {
    this.log('success', message, project);
  }

  warning(message: string, project?: string) {
    this.log('warning', message, project);
  }

  error(message: string, project?: string) {
    this.log('error', message, project);
  }
}


export const eventBus = new ServerEventBus();
