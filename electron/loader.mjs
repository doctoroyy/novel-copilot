/**
 * Node.js ESM Loader Hook
 *
 * 拦截 Cloudflare 特有模块导入，重定向到本地 shim。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 需要重定向的模块映射
const SHIM_MAP = {
  '@cloudflare/playwright': path.join(__dirname, 'shims', 'cloudflare-playwright.ts'),
};

export async function resolve(specifier, context, nextResolve) {
  // 检查是否是需要 shim 的模块
  if (SHIM_MAP[specifier]) {
    return {
      url: pathToFileURL(SHIM_MAP[specifier]).href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
