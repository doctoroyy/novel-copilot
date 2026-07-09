#!/usr/bin/env node
/**
 * Desktop sidecar smoke test
 *
 * 1. 用临时 APP_DATA_DIR 启动本地 Hono sidecar
 * 2. 访问 /api/health
 * 3. 创建临时项目并验证 SQLite 写入
 * 4. 清理并退出
 *
 * 用法: pnpm smoke:desktop
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const electronDir = path.join(rootDir, 'electron');

const PORT = Number(process.env.SMOKE_PORT || 18787);
const APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-copilot-smoke-'));
const BASE = `http://127.0.0.1:${PORT}`;

function log(msg) {
  console.log(`[smoke:desktop] ${msg}`);
}

async function waitForHealth(maxWaitMs = 45000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        return await res.json();
      }
      lastErr = new Error(`health status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`sidecar 未在 ${maxWaitMs}ms 内就绪: ${lastErr?.message || lastErr}`);
}

async function main() {
  log(`临时数据目录: ${APP_DATA_DIR}`);
  log(`端口: ${PORT}`);

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--import', './loader.mjs', 'standalone.ts'],
    {
      cwd: electronDir,
      env: {
        ...process.env,
        APP_DATA_DIR,
        SIDECAR_PORT: String(PORT),
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let exitCode = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  const shutdown = async () => {
    if (exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  try {
    const health = await waitForHealth();
    if (health.status !== 'ok' || health.mode !== 'local') {
      throw new Error(`health 响应异常: ${JSON.stringify(health)}`);
    }
    log(`health ok: ${JSON.stringify(health)}`);

    const meRes = await fetch(`${BASE}/api/auth/me`);
    const me = await meRes.json();
    if (!me.success || me.user?.id !== 'local-user') {
      throw new Error(`auth/me 异常: ${JSON.stringify(me)}`);
    }
    log('local-user 已注入');

    const projectName = `smoke-${Date.now()}`;
    const createRes = await fetch(`${BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectName,
        bible: 'Smoke test story bible. 本地优先冒烟测试设定。',
        totalChapters: 10,
        minChapterWords: 2500,
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok || !created.success || !created.project?.id) {
      throw new Error(`创建项目失败: ${JSON.stringify(created)}`);
    }
    log(`项目已创建: ${created.project.id}`);

    const listRes = await fetch(`${BASE}/api/projects`);
    const list = await listRes.json();
    if (!list.success || !Array.isArray(list.projects)) {
      throw new Error(`项目列表异常: ${JSON.stringify(list)}`);
    }
    const found = list.projects.find((p) => p.id === created.project.id);
    if (!found) {
      throw new Error('新建项目未出现在列表中');
    }
    log(`项目列表可见: ${found.name}`);

    const getRes = await fetch(`${BASE}/api/projects/${created.project.id}`);
    const detail = await getRes.json();
    if (!detail.success || detail.project?.bible?.includes('Smoke test') !== true) {
      throw new Error(`项目详情/SQLite 读取异常: ${JSON.stringify(detail).slice(0, 400)}`);
    }
    log('SQLite 读写正常');

    // Story Vault
    const vaultRes = await fetch(`${BASE}/api/projects/${created.project.id}/vault`);
    const vaultJson = await vaultRes.json();
    if (!vaultRes.ok || !vaultJson.success || !vaultJson.vault) {
      throw new Error(`vault 加载失败: ${JSON.stringify(vaultJson).slice(0, 400)}`);
    }
    log(`Story Vault ok: entities=${vaultJson.vault.entities.length}, threads=${vaultJson.vault.threads.length}`);

    const entityRes = await fetch(`${BASE}/api/projects/${created.project.id}/vault/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'character',
        name: '烟雾测试角色',
        content: '用于 smoke test 的角色设定',
        importance: 4,
      }),
    });
    const entityJson = await entityRes.json();
    if (!entityRes.ok || !entityJson.success) {
      throw new Error(`创建 vault entity 失败: ${JSON.stringify(entityJson)}`);
    }
    log(`Vault entity created: ${entityJson.entity.id}`);

    const extractRes = await fetch(`${BASE}/api/projects/${created.project.id}/vault/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '角色：林远，青云城少主。\n伏笔：血玉下落不明。\n地点：青云城东市。',
        sourceType: 'manual',
      }),
    });
    const extractJson = await extractRes.json();
    if (!extractRes.ok || !extractJson.success || !extractJson.proposal?.id) {
      throw new Error(`extract 失败: ${JSON.stringify(extractJson)}`);
    }
    const acceptRes = await fetch(`${BASE}/api/projects/${created.project.id}/vault/extract/${extractJson.proposal.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const acceptJson = await acceptRes.json();
    if (!acceptRes.ok || !acceptJson.success) {
      throw new Error(`accept extract 失败: ${JSON.stringify(acceptJson)}`);
    }
    log(`Vault extract accepted: entities=${acceptJson.entities.length}, threads=${acceptJson.threads.length}`);


    const delRes = await fetch(`${BASE}/api/projects/${created.project.id}`, {
      method: 'DELETE',
    });
    const deleted = await delRes.json();
    if (!deleted.success) {
      throw new Error(`删除项目失败: ${JSON.stringify(deleted)}`);
    }
    log('临时项目已清理');

    await shutdown();
    log('PASS');
  } catch (error) {
    console.error('[smoke:desktop] FAIL:', error.message || error);
    if (stdout.trim()) console.error('--- sidecar stdout ---\n' + stdout.slice(-4000));
    if (stderr.trim()) console.error('--- sidecar stderr ---\n' + stderr.slice(-4000));
    await shutdown();
    process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(APP_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main();
