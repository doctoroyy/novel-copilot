import type { Database } from 'better-sqlite3';
import { getDb } from '../db/db.js';
import { Hono } from 'hono';
import { getProviderPreset, getProviderPresets, normalizeGeminiBaseUrl, normalizeProviderId, buildOpenAiModelsUrl } from '../services/providerCatalog.js';
import {
  getImagineTemplateSnapshot,
  listImagineTemplateSnapshotDates,
} from '../services/imagineTemplateService.js';
import {
  createImagineTemplateRefreshJob,
  enqueueImagineTemplateRefreshJob,
  getImagineTemplateRefreshJob,
  listImagineTemplateRefreshJobs,
} from '../services/imagineTemplateJobService.js';

interface Bindings {
  DB: Database;
  FANQIE_BROWSER?: Fetcher;
  GENERATION_QUEUE?: Queue<any>;
}

const adminRoutes = new Hono<{ Bindings: Bindings }>();
const SUMMARY_INTERVAL_SETTING_KEY = 'summary_update_interval';
const MIN_SUMMARY_UPDATE_INTERVAL = 1;
const MAX_SUMMARY_UPDATE_INTERVAL = 20;

// Admin middleware - check if user is admin
const requireAdmin = async (c: any, next: () => Promise<void>) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: '未登录' }, 401);
  }

  const user = getDb().prepare(`
    SELECT role FROM users WHERE id = ?
  `).get(userId);

  if (!user || (user as any).role !== 'admin') {
    return c.json({ success: false, error: '需要管理员权限' }, 403);
  }

  await next();
};

// Apply admin middleware to all routes
adminRoutes.use('/*', requireAdmin);

// Get all users with stats
adminRoutes.get('/users', async (c) => {
  try {
    const users = getDb().prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.created_at,
        COUNT(DISTINCT p.id) as project_count,
        COALESCE(SUM(
          CASE WHEN ch.deleted_at IS NULL THEN 1 ELSE 0 END
        ), 0) as total_chapters
      FROM users u
      LEFT JOIN projects p ON u.id = p.user_id AND p.deleted_at IS NULL
      LEFT JOIN chapters ch ON p.id = ch.project_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    return c.json({ success: true, users });
  } catch (error) {
    console.error('Fetch users error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get user activity
adminRoutes.get('/users/:id/projects', async (c) => {
  const userId = c.req.param('id');

  try {
    const projects = getDb().prepare(`
      SELECT 
        p.id, 
        p.name, 
        p.created_at,
        s.next_chapter_index - 1 as chapters_written,
        s.total_chapters
      FROM projects p
      LEFT JOIN states s ON p.id = s.project_id
      WHERE p.user_id = ? AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `).all(userId);

    return c.json({ success: true, projects });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get AI imagine template snapshot summary (admin)
adminRoutes.get('/bible-templates', async (c) => {
  try {
    const snapshotDate = c.req.query('snapshotDate') || undefined;
    const snapshot = await getImagineTemplateSnapshot(c.env.DB, snapshotDate);
    const availableSnapshots = await listImagineTemplateSnapshotDates(c.env.DB, 60);
    const latestJobs = await listImagineTemplateRefreshJobs(c.env.DB, { limit: 5 });

    return c.json({
      success: true,
      snapshotDate: snapshot?.snapshotDate || null,
      templateCount: snapshot?.templates.length || 0,
      hotCount: snapshot?.ranking.length || 0,
      templates: snapshot?.templates || [],
      rankingPreview: (snapshot?.ranking || []).slice(0, 20),
      status: snapshot?.status || null,
      errorMessage: snapshot?.errorMessage || null,
      availableSnapshots,
      latestJobs,
      latestJob: latestJobs[0] || null,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Manually refresh AI imagine templates (admin)
adminRoutes.post('/bible-templates/refresh', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const userId = c.get('userId');
    const snapshotDate = typeof body.snapshotDate === 'string' ? body.snapshotDate : undefined;
    const force = body.force === undefined ? true : Boolean(body.force);

    const { job, created } = await createImagineTemplateRefreshJob(c.env.DB, {
      snapshotDate,
      force,
      requestedByUserId: userId || null,
      requestedByRole: 'admin',
      source: 'admin_manual',
    });

    await enqueueImagineTemplateRefreshJob({
      env: c.env,
      jobId: job.id,
      executionCtx: c.executionCtx,
    });

    return c.json({
      success: true,
      queued: true,
      created,
      job,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

adminRoutes.get('/bible-templates/jobs', async (c) => {
  try {
    const limitRaw = Number.parseInt(c.req.query('limit') || '20', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    const jobs = await listImagineTemplateRefreshJobs(c.env.DB, { limit });
    return c.json({ success: true, jobs });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

adminRoutes.get('/bible-templates/jobs/:id', async (c) => {
  try {
    const jobId = c.req.param('id');
    const job = await getImagineTemplateRefreshJob(c.env.DB, jobId);
    if (!job) {
      return c.json({ success: false, error: 'Template refresh job not found' }, 404);
    }
    return c.json({ success: true, job });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get system stats
adminRoutes.get('/stats', async (c) => {
  try {
    const userCount = getDb().prepare(`
      SELECT COUNT(*) as count FROM users
    `).get() as any;

    const projectCount = getDb().prepare(`
      SELECT COUNT(*) as count FROM projects WHERE deleted_at IS NULL
    `).get() as any;

    const chapterCount = getDb().prepare(`
      SELECT COUNT(*) as count FROM chapters WHERE deleted_at IS NULL
    `).get() as any;

    // Get recent activity
    const recentProjects = getDb().prepare(`
      SELECT 
        p.name,
        p.created_at,
        u.username
      FROM projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT 10
    `).all();

    return c.json({
      success: true,
      stats: {
        userCount: userCount?.count || 0,
        projectCount: projectCount?.count || 0,
        chapterCount: chapterCount?.count || 0,
      },
      recentProjects,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Credit Features Management
// ==========================================

// Get all credit features
adminRoutes.get('/credit-features', async (c) => {
  try {
    const results = getDb().prepare(
      'SELECT * FROM credit_features ORDER BY category, feature_key'
    ).all();
    return c.json({ success: true, features: results });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create credit feature
adminRoutes.post('/credit-features', async (c) => {
  try {
    const { featureKey, name, description, baseCost, category, isVipOnly, modelMultiplierEnabled } = await c.req.json();
    if (!featureKey || !name) {
      return c.json({ success: false, error: '功能标识和名称不能为空' }, 400);
    }

    getDb().prepare(`
      INSERT INTO credit_features (feature_key, name, description, base_cost, category, is_vip_only, model_multiplier_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(featureKey, name, description || '', baseCost || 10, category || 'basic', isVipOnly ? 1 : 0, modelMultiplierEnabled !== false ? 1 : 0);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update credit feature
adminRoutes.put('/credit-features/:key', async (c) => {
  const key = c.req.param('key');
  try {
    const { name, description, baseCost, category, isVipOnly, isActive, modelMultiplierEnabled } = await c.req.json();

    getDb().prepare(`
      UPDATE credit_features 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          base_cost = COALESCE(?, base_cost),
          category = COALESCE(?, category),
          is_vip_only = COALESCE(?, is_vip_only),
          is_active = COALESCE(?, is_active),
          model_multiplier_enabled = COALESCE(?, model_multiplier_enabled),
          updated_at = (unixepoch() * 1000)
      WHERE feature_key = ?
    `).bind(
      name ?? null, description ?? null, baseCost ?? null, category ?? null,
      isVipOnly !== undefined ? (isVipOnly ? 1 : 0) : null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      modelMultiplierEnabled !== undefined ? (modelMultiplierEnabled ? 1 : 0) : null,
      key
    ).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete credit feature
adminRoutes.delete('/credit-features/:key', async (c) => {
  const key = c.req.param('key');
  try {
    getDb().prepare('DELETE FROM credit_features WHERE feature_key = ?').run(key);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Feature Model Mappings Management
// ==========================================

// Get all feature model mappings
adminRoutes.get('/feature-models', async (c) => {
  try {
    const results = getDb().prepare(`
      SELECT fmm.*, m.model_name, m.provider_id as provider, cf.name as feature_name
      FROM feature_model_mappings fmm
      JOIN model_registry m ON fmm.model_id = m.id
      JOIN credit_features cf ON fmm.feature_key = cf.feature_key
    `).all();
    return c.json({ success: true, mappings: results });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update feature model mapping
adminRoutes.post('/feature-models', async (c) => {
  try {
    const { featureKey, modelId, temperature } = await c.req.json();

    if (!featureKey || !modelId) {
      return c.json({ success: false, error: 'featureKey and modelId are required' }, 400);
    }

    getDb().prepare(`
      INSERT INTO feature_model_mappings (feature_key, model_id, temperature)
      VALUES (?, ?, ?)
      ON CONFLICT(feature_key) DO UPDATE SET
        model_id = excluded.model_id,
        temperature = excluded.temperature,
        updated_at = (unixepoch() * 1000)
    `).run(featureKey, modelId, temperature || 0.7);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Model Registry Management
// ==========================================

// ==========================================
// Provider Registry API
// ==========================================

// Get all providers
adminRoutes.get('/provider-registry', async (c) => {
  try {
    const results = getDb().prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM model_registry m WHERE m.provider_id = p.id) as model_count
      FROM provider_registry p
      ORDER BY p.display_order ASC, p.id ASC
    `).all();

    // Mask API keys for display
    const masked = (results || []).map((p: any) => ({
      ...p,
      api_key_encrypted: p.api_key_encrypted
        ? `${p.api_key_encrypted.slice(0, 8)}...${p.api_key_encrypted.slice(-4)}`
        : null,
    }));
    return c.json({ success: true, providers: masked });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update provider
adminRoutes.put('/provider-registry/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const { apiKey, baseUrl, configJson, name } = await c.req.json();
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(String(name).trim()); }
    if (apiKey !== undefined) { updates.push('api_key_encrypted = ?'); values.push(apiKey || null); }
    if (baseUrl !== undefined) {
      const normalizedBaseUrl = id === 'gemini' ? (normalizeGeminiBaseUrl(baseUrl) || null) : (baseUrl || null);
      updates.push('base_url = ?');
      values.push(normalizedBaseUrl);
    }
    if (configJson !== undefined) { updates.push('config_json = ?'); values.push(JSON.stringify(configJson)); }

    if (updates.length > 0) {
      updates.push("updated_at = (unixepoch() * 1000)");
      values.push(id);
      getDb().prepare(`
        UPDATE provider_registry SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Model Registry API
// ==========================================

// Create provider
adminRoutes.post('/provider-registry', async (c) => {
  try {
    const { id, name, protocol, baseUrl, apiKey } = await c.req.json();
    if (!id || !name) {
      return c.json({ success: false, error: 'id 和 name 不能为空' }, 400);
    }

    const existing = getDb().prepare('SELECT id FROM provider_registry WHERE id = ?').get(id);
    if (existing) {
      return c.json({ success: false, error: 'Provider 已存在' }, 400);
    }

    // Get max display_order
    const maxOrder = getDb().prepare(
      'SELECT COALESCE(MAX(display_order), -1) as max_order FROM provider_registry'
    ).get() as any;

    getDb().prepare(`
      INSERT INTO provider_registry (id, name, protocol, base_url, api_key_encrypted, display_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id.trim(),
      name.trim(),
      protocol || 'openai',
      baseUrl || null,
      apiKey || null,
      (maxOrder?.max_order ?? -1) + 1
    ).run();

    return c.json({ success: true, id: id.trim() });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete provider (cascade: delete all models + feature_model_mappings)
adminRoutes.delete('/provider-registry/:id', async (c) => {
  const id = c.req.param('id');
  try {
    // First delete feature_model_mappings for all models of this provider
    getDb().prepare(`
      DELETE FROM feature_model_mappings
      WHERE model_id IN (SELECT id FROM model_registry WHERE provider_id = ?)
    `).run(id);

    // Delete all models of this provider
    getDb().prepare('DELETE FROM model_registry WHERE provider_id = ?').run(id);

    // Delete the provider itself
    getDb().prepare('DELETE FROM provider_registry WHERE id = ?').run(id);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Toggle provider enabled status
adminRoutes.patch('/provider-registry/:id/toggle', async (c) => {
  const id = c.req.param('id');
  try {
    const provider = getDb().prepare('SELECT enabled FROM provider_registry WHERE id = ?').get(id) as any;
    if (!provider) {
      return c.json({ success: false, error: 'Provider 不存在' }, 404);
    }

    const newEnabled = provider.enabled ? 0 : 1;

    // Toggle provider
    getDb().prepare(
      'UPDATE provider_registry SET enabled = ?, updated_at = (unixepoch() * 1000) WHERE id = ?'
    ).run(newEnabled, id);

    // If disabling, also disable all models
    if (!newEnabled) {
      getDb().prepare(
        'UPDATE model_registry SET is_active = 0, updated_at = (unixepoch() * 1000) WHERE provider_id = ?'
      ).run(id);
    }

    return c.json({ success: true, enabled: Boolean(newEnabled) });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Model Registry API
// ==========================================
adminRoutes.get('/model-registry', async (c) => {
  try {
    const results = getDb().prepare(`
      SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id, p.name as provider_name
      FROM model_registry m
      JOIN provider_registry p ON m.provider_id = p.id
      ORDER BY m.is_default DESC, p.id, m.model_name
    `).all();
    
    // Mask provider keys for display
    const masked = (results || []).map((m: any) => {
      const { provider_api_key, ...rest } = m;
      return {
        ...rest,
        provider: m.provider_id, // Backward compatibility for UI
        provider_name: m.provider_name || m.provider_id,
        api_key_encrypted: provider_api_key
          ? `${provider_api_key.slice(0, 8)}...${provider_api_key.slice(-4)}`
          : null,
        base_url: m.provider_base_url
      };
    });
    return c.json({ success: true, models: masked });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create model
adminRoutes.post('/model-registry', async (c) => {
  try {
    const { providerId, customProviderName, modelName, displayName, creditMultiplier, capabilities, configJson } = await c.req.json();
    if (!providerId || !modelName) {
      return c.json({ success: false, error: 'providerId, modelName 不能为空' }, 400);
    }

    // Ensure provider exists
    const provider = getDb().prepare('SELECT id FROM provider_registry WHERE id = ?').get(providerId);
    if (!provider) {
      // Auto-create provider if it's a known preset
      const preset = getProviderPreset(providerId);
      if (preset) {
        getDb().prepare(`
          INSERT INTO provider_registry (id, name, protocol, base_url)
          VALUES (?, ?, ?, ?)
        `).run(preset.id, preset.label, preset.protocol, preset.defaultBaseUrl || null);
      } else if (providerId.startsWith('custom')) {
        getDb().prepare(`
          INSERT INTO provider_registry (id, name, protocol, base_url)
          VALUES (?, ?, ?, ?)
        `).run(providerId, customProviderName || providerId, 'openai', null);
      } else {
        return c.json({ success: false, error: 'Provider 不存在且非预设' }, 400);
      }
    }

    const id = crypto.randomUUID();
    getDb().prepare(`
      INSERT INTO model_registry (id, provider_id, model_name, display_name, credit_multiplier, capabilities, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, providerId, modelName.trim(), (displayName || modelName).trim(),
      creditMultiplier || 1.0,
      JSON.stringify(capabilities || []),
      JSON.stringify(configJson || {})
    ).run();

    return c.json({ success: true, id });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update model
adminRoutes.put('/model-registry/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json();
    const updates: string[] = [];
    const values: any[] = [];

    if (body.displayName !== undefined) { updates.push('display_name = ?'); values.push(String(body.displayName || '').trim()); }
    if (body.modelName !== undefined) { updates.push('model_name = ?'); values.push(String(body.modelName || '').trim()); }
    if (body.creditMultiplier !== undefined) { updates.push('credit_multiplier = ?'); values.push(Number(body.creditMultiplier)); }
    if (body.capabilities !== undefined) { updates.push('capabilities = ?'); values.push(JSON.stringify(body.capabilities)); }
    if (body.isActive !== undefined) { updates.push('is_active = ?'); values.push(body.isActive ? 1 : 0); }
    if (body.configJson !== undefined) { updates.push('config_json = ?'); values.push(JSON.stringify(body.configJson)); }
    
    if (body.isDefault !== undefined) {
      if (body.isDefault) {
        getDb().prepare('UPDATE model_registry SET is_default = 0').run();
      }
      updates.push('is_default = ?');
      values.push(body.isDefault ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = (unixepoch() * 1000)");
      values.push(id);
      getDb().prepare(`
        UPDATE model_registry SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Batch delete models
adminRoutes.delete('/model-registry/batch', async (c) => {
  try {
    const { ids } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ success: false, error: '未选择任何模型' }, 400);
    }

    let deletedCount = 0;
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      const placeholders = chunk.map(() => '?').join(', ');

      getDb().prepare(`DELETE FROM feature_model_mappings WHERE model_id IN (${placeholders})`).run(...chunk);
      const res = getDb().prepare(`DELETE FROM model_registry WHERE id IN (${placeholders})`).run(...chunk);
      deletedCount += res.changes || 0;
    }

    return c.json({ success: true, count: deletedCount });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete model
adminRoutes.delete('/model-registry/:id', async (c) => {
  const id = c.req.param('id');
  try {
    getDb().prepare('DELETE FROM feature_model_mappings WHERE model_id = ?').run(id);
    getDb().prepare('DELETE FROM model_registry WHERE id = ?').run(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Credit Stats & User Management
// ==========================================

// Get credit stats
adminRoutes.get('/credit-stats', async (c) => {
  try {
    const totalCredit = getDb().prepare(
      'SELECT SUM(credit_balance) as total FROM users'
    ).get() as any;

    const totalConsumed = getDb().prepare(
      "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM credit_transactions WHERE type = 'consume'"
    ).get() as any;

    const totalRecharged = getDb().prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions WHERE type IN ('recharge', 'reward')"
    ).get() as any;

    const topFeatures = getDb().prepare(`
      SELECT feature_key, COUNT(*) as usage_count, SUM(ABS(amount)) as total_cost
      FROM credit_transactions WHERE type = 'consume'
      GROUP BY feature_key ORDER BY usage_count DESC LIMIT 10
    `).all();

    return c.json({
      success: true,
      stats: {
        totalCreditInCirculation: totalCredit?.total || 0,
        totalConsumed: totalConsumed?.total || 0,
        totalRecharged: totalRecharged?.total || 0,
        topFeatures: topFeatures,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Recharge user credit
adminRoutes.post('/users/:id/credit', async (c) => {
  const userId = c.req.param('id');
  try {
    const { amount, description } = await c.req.json();
    if (!amount || amount <= 0) {
      return c.json({ success: false, error: '充值金额必须大于 0' }, 400);
    }

    // Get current balance
    const user = getDb().prepare(
      'SELECT credit_balance FROM users WHERE id = ?'
    ).get(userId) as any;

    if (!user) {
      return c.json({ success: false, error: '用户不存在' }, 404);
    }

    const balanceAfter = (user.credit_balance || 0) + amount;

    const tx = c.env.DB.transaction(() => {
      getDb().prepare('UPDATE users SET credit_balance = ? WHERE id = ?').run(balanceAfter, userId);
      getDb().prepare(`
        INSERT INTO credit_transactions (user_id, feature_key, amount, balance_after, type, description)
        VALUES (?, NULL, ?, ?, 'recharge', ?)
      `).run(userId, amount, balanceAfter, description || '管理员充值');
    });
    tx();

    return c.json({ success: true, balanceAfter });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Generation settings
// ==========================================

adminRoutes.get('/generation-settings', async (c) => {
  try {
    const row = getDb().prepare(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = ?
      LIMIT 1
    `).get(SUMMARY_INTERVAL_SETTING_KEY) as { setting_value?: string } | null;

    const parsed = Number.parseInt(String(row?.setting_value ?? ''), 10);
    const summaryUpdateInterval = Number.isInteger(parsed)
      && parsed >= MIN_SUMMARY_UPDATE_INTERVAL
      && parsed <= MAX_SUMMARY_UPDATE_INTERVAL
      ? parsed
      : 2;

    return c.json({
      success: true,
      settings: {
        summaryUpdateInterval,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

adminRoutes.put('/generation-settings', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = Number.parseInt(String(body?.summaryUpdateInterval ?? ''), 10);

    if (!Number.isInteger(parsed)) {
      return c.json({ success: false, error: 'summaryUpdateInterval 必须是整数' }, 400);
    }
    if (parsed < MIN_SUMMARY_UPDATE_INTERVAL || parsed > MAX_SUMMARY_UPDATE_INTERVAL) {
      return c.json({
        success: false,
        error: `summaryUpdateInterval 取值范围为 ${MIN_SUMMARY_UPDATE_INTERVAL}~${MAX_SUMMARY_UPDATE_INTERVAL}`,
      }, 400);
    }

    getDb().prepare(`
      INSERT INTO system_settings (setting_key, setting_value, description, updated_at)
      VALUES (?, ?, ?, (unixepoch() * 1000))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        description = excluded.description,
        updated_at = (unixepoch() * 1000)
    `).bind(
      SUMMARY_INTERVAL_SETTING_KEY,
      String(parsed),
      '批量生成时摘要更新间隔（章）'
    ).run();

    return c.json({
      success: true,
      settings: {
        summaryUpdateInterval: parsed,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Provider presets + remote model fetch
// ==========================================

adminRoutes.get('/provider-presets', async (c) => {
  return c.json({
    success: true,
    providers: getProviderPresets().map((item) => ({
      id: item.id,
      label: item.label,
      protocol: item.protocol,
      defaultBaseUrl: item.defaultBaseUrl || '',
      isCustom: Boolean(item.isCustom),
      color: item.color || '#6b7280',
    })),
  });
});

// 从远程 API 获取可用模型列表
adminRoutes.post('/fetch-models', async (c) => {
  try {
    const { provider, apiKey, baseUrl } = await c.req.json();

    if (!provider || !apiKey) {
      return c.json({ success: false, error: 'provider 和 apiKey 不能为空' }, 400);
    }

    const normalizedProvider = normalizeProviderId(String(provider));
    const preset = getProviderPreset(normalizedProvider);
    const providerType = preset?.protocol || 'openai';
    const effectiveBaseUrl = String(baseUrl || '').trim() || preset?.defaultBaseUrl;

    if (!effectiveBaseUrl) {
      return c.json({
        success: false,
        error: `请提供 Base URL。provider=${normalizedProvider} 未配置默认地址`,
      }, 400);
    }

    let models: { id: string; name: string; displayName: string }[] = [];

    if (providerType === 'gemini') {
      const geminiBaseUrl = normalizeGeminiBaseUrl(effectiveBaseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
      // Gemini API: GET /models?key=xxx
      const res = await fetch(
        `${geminiBaseUrl}/models?key=${apiKey}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Gemini API 错误: ${res.status}`);
      }

      const data = await res.json() as any;
      models = (data.models || [])
        .filter((m: any) => {
          // 只保留支持 generateContent 的模型（能用于文本生成的）
          const methods = m.supportedGenerationMethods || [];
          return methods.includes('generateContent') || methods.includes('streamGenerateContent');
        })
        .map((m: any) => ({
          // Gemini 模型名格式: "models/gemini-2.5-pro" → 提取 "gemini-2.5-pro"
          id: m.name?.replace('models/', '') || m.name,
          name: m.name?.replace('models/', '') || m.name,
          displayName: m.displayName || m.name?.replace('models/', '') || m.name,
        }));
    } else if (providerType === 'anthropic') {
      const res = await fetch(`${effectiveBaseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } })) as any;
        throw new Error(err.error?.message || err.message || `Anthropic API 错误: ${res.status}`);
      }

      const data = await res.json() as any;
      const modelList = data.data || [];
      models = modelList.map((m: any) => ({
        id: m.id || m.name,
        name: m.id || m.name,
        displayName: m.display_name || m.id || m.name,
      }));
    } else {
      // OpenAI 兼容 API: GET /v1/models 或 /models（按 base URL 是否已带版本号判断）
      const modelsUrl = buildOpenAiModelsUrl(effectiveBaseUrl);

      const res = await fetch(modelsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } })) as any;
        throw new Error(err.error?.message || `API 错误: ${res.status}`);
      }

      const data = await res.json() as any;
      const modelList = data.data || data.models || [];
      models = modelList.map((m: any) => ({
        id: m.id || m.name,
        name: m.id || m.name,
        displayName: m.id || m.name,
      }));
    }

    // 按名称排序
    models.sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      success: true,
      provider: normalizedProvider,
      protocol: providerType,
      baseUrl: providerType === 'gemini'
        ? (normalizeGeminiBaseUrl(effectiveBaseUrl) || 'https://generativelanguage.googleapis.com/v1beta')
        : effectiveBaseUrl,
      models,
      count: models.length,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

export { adminRoutes };
