import { serve } from '@hono/node-server';
import { app } from './worker.js';
import { getDb } from './db/db.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

export function startLocalServer(port = 8787): Promise<{ port: number, close: () => void }> {
  // Initialize app data dir
  const appDataDir = resolve(homedir(), '.novel-copilot');
  mkdirSync(appDataDir, { recursive: true });
  
  // Make sure DB is initialized
  getDb();

  return new Promise((resolvePromise) => {
    const server = serve({
      fetch(request: Request) {
        // Inject the environment bindings
        const env = {
          DB: getDb(),
          // Mock R2Bucket or FileSystem wrapper for ANIME_VIDEOS if needed
          ANIME_VIDEOS: {} as any, 
          GENERATION_QUEUE: {} as any,
        };
        // Construct ExecutionContext mock
        const ctx = {
          waitUntil: (promise: Promise<any>) => {
             promise.catch(console.error);
          },
          passThroughOnException: () => {},
          props: {}
        };
        
        return app.fetch(request, env, ctx);
      },
      port
    }, (info) => {
      console.log(`Local server started on http://localhost:${info.port}`);
      resolvePromise({
        port: info.port,
        close: () => server.close()
      });
    });
  });
}
