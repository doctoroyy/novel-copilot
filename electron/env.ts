/**
 * 本地环境适配层
 *
 * 替代 Cloudflare Workers 的 Env 绑定：
 * - DB: D1Database → 同步 better-sqlite3（通过 src/db/db.ts 的 getDb()）
 * - ANIME_VIDEOS: R2Bucket → 本地文件系统
 * - GENERATION_QUEUE: Queue → 进程内队列
 * - FANQIE_BROWSER: Fetcher → 不可用
 * - JWT_SECRET → 固定值（本地无需认证）
 */

import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { getDb } from '../src/db/db.js';
import { LocalQueue } from './queue.js';

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  body?: ReadableStream;
}

export interface R2PutOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface R2Bucket {
  get(key: string): Promise<(R2Object & R2ObjectBody) | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string | ReadableStream | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2Object>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
  head(key: string): Promise<R2Object | null>;
}

class LocalR2Bucket implements R2Bucket {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    const safePath = key.replace(/\.\./g, '_');
    return path.join(this.baseDir, safePath);
  }

  async get(key: string): Promise<(R2Object & R2ObjectBody) | null> {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    const buffer = fs.readFileSync(filePath);

    return {
      key,
      size: stat.size,
      etag: `"${stat.mtimeMs}"`,
      httpEtag: `"${stat.mtimeMs}"`,
      uploaded: stat.mtime,
      async arrayBuffer() {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
      async text() {
        return buffer.toString('utf-8');
      },
      async json<T>(): Promise<T> {
        return JSON.parse(buffer.toString('utf-8'));
      },
      async blob() {
        return new Blob([buffer]);
      },
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string | ReadableStream | Blob | null,
    _options?: R2PutOptions,
  ): Promise<R2Object> {
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let data: Buffer;
    if (value === null) {
      data = Buffer.alloc(0);
    } else if (typeof value === 'string') {
      data = Buffer.from(value, 'utf-8');
    } else if (value instanceof ArrayBuffer) {
      data = Buffer.from(value);
    } else if (value instanceof Uint8Array) {
      data = Buffer.from(value);
    } else if (value instanceof Blob) {
      const ab = await value.arrayBuffer();
      data = Buffer.from(ab);
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        if (result.value) chunks.push(result.value);
        done = result.done;
      }
      data = Buffer.concat(chunks);
    }

    fs.writeFileSync(filePath, data);

    return {
      key,
      size: data.length,
      etag: `"${Date.now()}"`,
      httpEtag: `"${Date.now()}"`,
      uploaded: new Date(),
    };
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      const filePath = this.getFilePath(k);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix || '';
    const limit = options?.limit || 1000;
    const searchDir = path.join(this.baseDir, prefix);

    if (!fs.existsSync(searchDir)) {
      return { objects: [], truncated: false };
    }

    const files = this.listFilesRecursive(searchDir);
    const objects: R2Object[] = files.slice(0, limit).map((filePath) => {
      const key = path.relative(this.baseDir, filePath);
      const stat = fs.statSync(filePath);
      return {
        key,
        size: stat.size,
        etag: `"${stat.mtimeMs}"`,
        httpEtag: `"${stat.mtimeMs}"`,
        uploaded: stat.mtime,
      };
    });

    return {
      objects,
      truncated: files.length > limit,
    };
  }

  async head(key: string): Promise<R2Object | null> {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    return {
      key,
      size: stat.size,
      etag: `"${stat.mtimeMs}"`,
      httpEtag: `"${stat.mtimeMs}"`,
      uploaded: stat.mtime,
    };
  }

  private listFilesRecursive(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listFilesRecursive(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }
}

export interface LocalEnv {
  DB: Database.Database;
  ANIME_VIDEOS: R2Bucket;
  GENERATION_QUEUE: LocalQueue;
  FANQIE_BROWSER?: undefined;
  JWT_SECRET: string;
}

let _env: LocalEnv | null = null;

export function getAppDataDir(): string {
  return process.env.APP_DATA_DIR || path.join(process.env.HOME || '~', '.novel-copilot');
}

export async function initializeLocalEnv(): Promise<LocalEnv> {
  if (_env) return _env;

  const appDataDir = getAppDataDir();
  console.log(`[Env] 应用数据目录: ${appDataDir}`);

  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  // 同步初始化数据库（schema + migrations 都在 getDb 内部完成）
  const db = getDb();

  const storageDir = path.join(appDataDir, 'storage');
  const animeVideos = new LocalR2Bucket(path.join(storageDir, 'anime-videos'));

  const queue = new LocalQueue();

  _env = {
    DB: db,
    ANIME_VIDEOS: animeVideos,
    GENERATION_QUEUE: queue,
    FANQIE_BROWSER: undefined,
    JWT_SECRET: process.env.JWT_SECRET || 'novel-copilot-local-secret',
  };

  console.log('[Env] 本地环境初始化完成');
  return _env;
}

export function getLocalEnv(): LocalEnv {
  if (!_env) {
    throw new Error('环境未初始化，请先调用 initializeLocalEnv()');
  }
  return _env;
}
