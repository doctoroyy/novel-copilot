/**
 * Electron 生产构建脚本
 *
 * 使用 esbuild 将后端 + Electron 主进程打包为单文件 bundle，
 * 并编译 preload 脚本。
 *
 * 用法: cd electron && node scripts/build.mjs
 */

import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(electronDir, '..');
const outDir = path.join(electronDir, 'dist');

// 清理输出目录
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  outdir: outDir,
  external: [
    'electron',
    'better-sqlite3',
    '@cloudflare/playwright',
  ],
  alias: {
    '@cloudflare/playwright': path.join(electronDir, 'shims', 'cloudflare-playwright.ts'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: { '.sql': 'text' },
};

async function main() {
  console.log('🔨 构建 Electron 主进程...');

  // 主进程 bundle
  await build({
    ...sharedConfig,
    entryPoints: [path.join(electronDir, 'main.ts')],
    outExtension: { '.js': '.mjs' },
  });

  // 服务器 bundle（供 standalone 使用）
  await build({
    ...sharedConfig,
    entryPoints: [path.join(electronDir, 'standalone.ts')],
    outExtension: { '.js': '.mjs' },
  });

  // Preload 脚本（需要 CJS 格式，.js 扩展名）
  await build({
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    outdir: outDir,
    entryPoints: [path.join(electronDir, 'preload.ts')],
    outExtension: { '.js': '.js' },
    external: ['electron'],
  });

  // 复制 schema.sql 和 migrations
  const dbDir = path.join(outDir, 'db');
  fs.mkdirSync(dbDir, { recursive: true });
  fs.copyFileSync(
    path.join(rootDir, 'src', 'db', 'schema.sql'),
    path.join(dbDir, 'schema.sql')
  );

  const migrationsDir = path.join(rootDir, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const outMigrations = path.join(outDir, 'migrations');
    fs.mkdirSync(outMigrations, { recursive: true });
    for (const file of fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))) {
      fs.copyFileSync(
        path.join(migrationsDir, file),
        path.join(outMigrations, file)
      );
    }
  }

  console.log('✅ 构建完成: electron/dist/');
}

main().catch((error) => {
  console.error('❌ 构建失败:', error);
  process.exit(1);
});
