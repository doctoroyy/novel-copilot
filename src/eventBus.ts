import { EventEmitter } from 'node:events';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';
type EventUserId = string | null;

interface BaseServerEvent {
  id: number;
  createdAt: number;
  userId: EventUserId;
}

export interface LogEvent extends BaseServerEvent {
  type: 'log';
  level: LogLevel;
  message: string;
  timestamp: string;
  project?: string;
}

export interface ProgressEvent extends BaseServerEvent {
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
type EmittableServerEvent = Omit<LogEvent, 'id' | 'createdAt'> | Omit<ProgressEvent, 'id' | 'createdAt'>;

class ServerEventBus extends EventEmitter {
  private history: ServerEvent[] = [];
  private nextId = 1;
  private maxHistory = 500;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  private pushEvent(event: EmittableServerEvent): ServerEvent {
    const enriched = {
      ...event,
      id: this.nextId++,
      createdAt: Date.now(),
    } as unknown as ServerEvent;

    this.history.push(enriched);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    this.emit('event', enriched);
    return enriched;
  }

  log(level: LogLevel, message: string, project?: string, userId: EventUserId = null) {
    this.pushEvent({
      type: 'log',
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
      project,
      userId,
    });

    const prefix = {
      info: '[info]',
      success: '[ok]',
      warning: '[warn]',
      error: '[error]',
    }[level];
    console.log(`${prefix} ${message}`);
  }

  progress(data: Omit<ProgressEvent, 'type' | 'id' | 'createdAt' | 'userId'> & { userId?: EventUserId }) {
    this.pushEvent({
      ...data,
      type: 'progress',
      userId: data.userId ?? null,
    });
  }

  consumeSince(
    cursor = 0,
    options: {
      userId: string;
      limit?: number;
    }
  ): { events: ServerEvent[]; nextCursor: number } {
    const { userId, limit = 100 } = options;
    const events: ServerEvent[] = [];
    let nextCursor = cursor;

    for (const event of this.history) {
      if (event.id <= cursor) continue;
      nextCursor = event.id;

      if (event.userId !== userId) {
        continue;
      }

      events.push(event);
      if (events.length >= limit) {
        break;
      }
    }

    return { events, nextCursor };
  }

  info(message: string, project?: string, userId: EventUserId = null) {
    this.log('info', message, project, userId);
  }

  success(message: string, project?: string, userId: EventUserId = null) {
    this.log('success', message, project, userId);
  }

  warning(message: string, project?: string, userId: EventUserId = null) {
    this.log('warning', message, project, userId);
  }

  error(message: string, project?: string, userId: EventUserId = null) {
    this.log('error', message, project, userId);
  }
}

export const eventBus = new ServerEventBus();
