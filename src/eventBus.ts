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
  status: 'starting' | 'generating' | 'saving' | 'updating_summary' | 'done' | 'error';
  message?: string;
}

export type ServerEvent = LogEvent | ProgressEvent;

// Global event bus
class ServerEventBus extends EventEmitter {
  log(level: LogLevel, message: string, project?: string) {
    const event: LogEvent = {
      type: 'log',
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
      project,
    };
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
    this.emit('event', event);
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
