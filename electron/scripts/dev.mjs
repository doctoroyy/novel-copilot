/**
 * 一键开发模式启动脚本
 *
 * 1. 启动本地后端 HTTP 服务器（port 8787）
 * 2. 启动前端 Vite 开发服务器（port 5173，自动代理 /api 到 8787）
 * 3. 启动 Electron 窗口
 *
 * 用法: cd electron && node scripts/dev.mjs
 */

import { spawn, fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(electronDir, '..');

let backendProcess = null;
let viteProcess = null;
let electronProcess = null;

function cleanup() {
  console.log('\n🧹 清理进程...');
  if (electronProcess) electronProcess.kill();
  if (viteProcess) viteProcess.kill();
  if (backendProcess) backendProcess.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function waitForServer(url, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // 还没启动
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('🚀 Novel Copilot 开发模式启动中...\n');

  // 1. 启动后端
  console.log('📦 启动本地后端...');
  backendProcess = spawn('node', [
    '--import', 'tsx',
    '--loader', './loader.mjs',
    'standalone.ts'
  ], {
    cwd: electronDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      APP_DATA_DIR: path.join(process.env.HOME || '~', '.novel-copilot'),
    },
  });

  backendProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`  [后端] ${output}`);
  });

  backendProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    // 过滤掉迁移的冗余错误日志
    if (output.includes('duplicate column') || output.includes('ExperimentalWarning')) return;
    if (output) console.error(`  [后端] ${output}`);
  });

  backendProcess.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.error(`  [后端] 进程退出: ${code}`);
    }
  });

  // 等待后端启动
  const backendReady = await waitForServer('http://localhost:8787/api/health', 15000);
  if (!backendReady) {
    console.error('❌ 后端启动超时');
    cleanup();
    return;
  }
  console.log('✅ 后端就绪: http://localhost:8787\n');

  // 2. 启动前端 Vite
  console.log('🌐 启动前端...');
  viteProcess = spawn('pnpm', ['dev'], {
    cwd: path.join(rootDir, 'web'),
    stdio: 'pipe',
    shell: true,
  });

  viteProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`  [前端] ${output}`);
  });

  viteProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.error(`  [前端] ${output}`);
  });

  // 等待前端启动
  const frontendReady = await waitForServer('http://localhost:5173', 15000);
  if (!frontendReady) {
    console.error('❌ 前端启动超时');
    cleanup();
    return;
  }
  console.log('✅ 前端就绪: http://localhost:5173\n');

  // 3. 启动 Electron（可选）
  const skipElectron = process.argv.includes('--no-electron');
  if (!skipElectron) {
    console.log('🖥️  启动 Electron...');
    electronProcess = spawn('pnpm', ['exec', 'electron', '.'], {
      cwd: electronDir,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });

    electronProcess.on('close', () => {
      console.log('Electron 已关闭');
      cleanup();
    });
  } else {
    console.log('⏭️  跳过 Electron（--no-electron 模式）');
    console.log('\n📝 可以在浏览器中访问: http://localhost:5173\n');
    console.log('   按 Ctrl+C 停止所有服务\n');
  }
}

main().catch((error) => {
  console.error('启动失败:', error);
  cleanup();
});
