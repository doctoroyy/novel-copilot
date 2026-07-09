/**
 * Cloudflare Workers 类型垫片
 *
 * 为 Electron/Node.js 环境提供 Cloudflare 特有类型的声明，
 * 避免源代码中的 D1Database、R2Bucket 等类型报错。
 */

// D1 类型（已在 db.ts 中实现）
declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1Result>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  dump(): Promise<ArrayBuffer>;
}

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  raw<T = unknown[]>(): Promise<T[]>;
}

declare interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

// R2 类型
declare interface R2Bucket {
  get(key: string): Promise<(R2Object & R2ObjectBody) | null>;
  put(key: string, value: any, options?: any): Promise<R2Object>;
  delete(key: string | string[]): Promise<void>;
  list(options?: any): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  head(key: string): Promise<R2Object | null>;
}

declare interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  body?: ReadableStream;
}

declare interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

// Queue 类型
declare interface Queue<T = any> {
  send(body: T): Promise<void>;
  sendBatch(bodies: { body: T }[]): Promise<void>;
}

declare interface MessageBatch<T = any> {
  messages: {
    body: T;
    ack(): void;
    retry(): void;
  }[];
}

// Fetcher 类型
declare interface Fetcher {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

// ExecutionContext
declare interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

// ScheduledController
declare interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}
