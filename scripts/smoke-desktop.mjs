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

    // Phase 2: Chapter Blueprint
    const bpRes = await fetch(`${BASE}/api/projects/${created.project.id}/blueprints/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '第一章 启程',
        goal: { primary: '主角踏上修行之路' },
        conflict: '宗门试炼',
        hook: '神秘祖符',
        sceneBeats: [{ id: 'beat-1', summary: '开场', action: '登场', emotion: '紧张', infoReveal: '身世', characters: ['林远'] }],
        acceptanceCriteria: ['字数达标', '钩子明确'],
        authorNotes: '不要出现后期才有的设定',
      }),
    });
    const bpJson = await bpRes.json();
    if (!bpRes.ok || !bpJson.success || !bpJson.blueprint?.id) {
      throw new Error(`blueprint 保存失败: ${JSON.stringify(bpJson)}`);
    }
    log(`Chapter Blueprint saved: chapter ${bpJson.blueprint.chapterIndex}, status=${bpJson.blueprint.status}`);

    const bpGetRes = await fetch(`${BASE}/api/projects/${created.project.id}/blueprints/1`);
    const bpGetJson = await bpGetRes.json();
    if (!bpGetRes.ok || !bpGetJson.success || bpGetJson.blueprint?.title !== '第一章 启程') {
      throw new Error(`blueprint 读取失败: ${JSON.stringify(bpGetJson)}`);
    }
    log('Chapter Blueprint 读写正常');

    // Phase 2: Context Package (Context Inspector)
    const ctxRes = await fetch(`${BASE}/api/projects/${created.project.id}/context-package`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterIndex: 1,
        taskType: 'chapter_draft',
        rollingSummary: '主角林远在青云城',
        goalHint: '林远',
        totalChapters: 10,
      }),
    });
    const ctxJson = await ctxRes.json();
    if (!ctxRes.ok || !ctxJson.success || !ctxJson.package?.id) {
      throw new Error(`context package 构建失败: ${JSON.stringify(ctxJson).slice(0, 400)}`);
    }
    log(`Context Package built: hash=${ctxJson.package.promptHash}, tokens=${ctxJson.package.tokenBudget.estimatedTokens}/${ctxJson.package.tokenBudget.inputBudget}, items=${ctxJson.package.selectedItems.length}`);

    // Verify the context package was persisted
    const ctxListRes = await fetch(`${BASE}/api/projects/${created.project.id}/context-packages`);
    const ctxListJson = await ctxListRes.json();
    if (!ctxListRes.ok || !ctxListJson.success || ctxListJson.packages.length === 0) {
      throw new Error(`context packages 列表为空`);
    }
    log(`Context Packages persisted: ${ctxListJson.packages.length}`);

    // Phase 2: AI Job Ledger (summary should be empty but valid)
    const ledgerRes = await fetch(`${BASE}/api/projects/${created.project.id}/ledger/summary`);
    const ledgerJson = await ledgerRes.json();
    if (!ledgerRes.ok || !ledgerJson.success || typeof ledgerJson.summary?.totalJobs !== 'number') {
      throw new Error(`ledger summary 异常: ${JSON.stringify(ledgerJson)}`);
    }
    log(`Ledger summary ok: totalJobs=${ledgerJson.summary.totalJobs}`);

    // Phase 3: Project Health Board
    const healthRes = await fetch(`${BASE}/api/projects/${created.project.id}/health`);
    const healthJson = await healthRes.json();
    if (!healthRes.ok || !healthJson.success || !healthJson.health?.dimensions) {
      throw new Error(`health 异常: ${JSON.stringify(healthJson).slice(0, 400)}`);
    }
    log(`Project Health ok: score=${healthJson.health.overallScore}, status=${healthJson.health.overallStatus}, dims=${healthJson.health.dimensions.length}`);

    // Phase 4: Genre templates
    const tplRes = await fetch(`${BASE}/api/projects/templates/genres`);
    const tplJson = await tplRes.json();
    if (!tplRes.ok || !tplJson.success || tplJson.templates.length < 3) {
      throw new Error(`genre templates 异常: ${JSON.stringify(tplJson)}`);
    }
    log(`Genre templates ok: ${tplJson.templates.length} templates`);

    // Phase 4: License activate + status
    const licActRes = await fetch(`${BASE}/api/config/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'NCP-P123-ABCD-EFGH-TEST' }),
    });
    const licActJson = await licActRes.json();
    if (!licActRes.ok || !licActJson.success || licActJson.license.tier !== 'pro') {
      throw new Error(`license 激活失败: ${JSON.stringify(licActJson)}`);
    }
    const licGetRes = await fetch(`${BASE}/api/config/license`);
    const licGetJson = await licGetRes.json();
    if (!licGetRes.ok || !licGetJson.success || licGetJson.license?.status !== 'active') {
      throw new Error(`license 状态异常: ${JSON.stringify(licGetJson)}`);
    }
    log(`License ok: tier=${licGetJson.license.tier}, status=${licGetJson.license.status}`);

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
