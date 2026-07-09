/**
 * 独立模式启动脚本
 *
 * 不依赖 Electron，直接启动本地 HTTP 后端。
 * 用于开发调试和验证后端迁移是否正确。
 *
 * 用法: cd electron && npx tsx standalone.ts
 */

import { startServer, stopServer } from './server.js';

async function main() {
  console.log('🚀 Novel Copilot 本地后端启动中...\n');

  // 设置应用数据目录
  if (!process.env.APP_DATA_DIR) {
    const path = await import('node:path');
    process.env.APP_DATA_DIR = path.join(process.env.HOME || '~', '.novel-copilot');
  }

  const port = await startServer();
  console.log(`\n✅ 后端已启动: http://localhost:${port}`);
  console.log('   按 Ctrl+C 停止\n');

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('\n正在停止...');
    await stopServer();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopServer();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
