import { Hono } from 'hono';

interface Bindings {
  DB: D1Database;
}

const adminRoutes = new Hono<{ Bindings: Bindings }>();

// Admin middleware - check if user is admin
const requireAdmin = async (c: any, next: () => Promise<void>) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: '未登录' }, 401);
  }
  
  const user = await c.env.DB.prepare(`
    SELECT role FROM users WHERE id = ?
  `).bind(userId).first();
  
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
    const { results: users } = await c.env.DB.prepare(`
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
    const { results: projects } = await c.env.DB.prepare(`
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
    `).bind(userId).all();
    
    return c.json({ success: true, projects });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get all invitation codes
adminRoutes.get('/invitation-codes', async (c) => {
  try {
    const { results: codes } = await c.env.DB.prepare(`
      SELECT 
        code, 
        max_uses, 
        used_count, 
        created_at,
        is_active
      FROM invitation_codes
      ORDER BY created_at DESC
    `).all();
    
    return c.json({ success: true, codes });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create invitation code
adminRoutes.post('/invitation-codes', async (c) => {
  try {
    const { code, maxUses = 10 } = await c.req.json();
    
    if (!code) {
      return c.json({ success: false, error: '请输入邀请码' }, 400);
    }
    
    // Check if code exists
    const existing = await c.env.DB.prepare(`
      SELECT code FROM invitation_codes WHERE code = ?
    `).bind(code).first();
    
    if (existing) {
      return c.json({ success: false, error: '邀请码已存在' }, 400);
    }
    
    await c.env.DB.prepare(`
      INSERT INTO invitation_codes (code, max_uses, used_count, is_active)
      VALUES (?, ?, 0, 1)
    `).bind(code, maxUses).run();
    
    return c.json({ success: true, code, maxUses });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete invitation code
adminRoutes.delete('/invitation-codes/:code', async (c) => {
  const code = c.req.param('code');
  
  try {
    await c.env.DB.prepare(`
      DELETE FROM invitation_codes WHERE code = ?
    `).bind(code).run();
    
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Toggle invitation code active status
adminRoutes.patch('/invitation-codes/:code', async (c) => {
  const code = c.req.param('code');
  const { isActive } = await c.req.json();
  
  try {
    await c.env.DB.prepare(`
      UPDATE invitation_codes SET is_active = ? WHERE code = ?
    `).bind(isActive ? 1 : 0, code).run();
    
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get system stats
adminRoutes.get('/stats', async (c) => {
  try {
    const userCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM users
    `).first() as any;
    
    const projectCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM projects WHERE deleted_at IS NULL
    `).first() as any;
    
    const chapterCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM chapters WHERE deleted_at IS NULL
    `).first() as any;
    
    // Get recent activity
    const { results: recentProjects } = await c.env.DB.prepare(`
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
    const { results } = await c.env.DB.prepare(
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

    await c.env.DB.prepare(`
      INSERT INTO credit_features (feature_key, name, description, base_cost, category, is_vip_only, model_multiplier_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(featureKey, name, description || '', baseCost || 10, category || 'basic', isVipOnly ? 1 : 0, modelMultiplierEnabled !== false ? 1 : 0).run();

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

    await c.env.DB.prepare(`
      UPDATE credit_features 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          base_cost = COALESCE(?, base_cost),
          category = COALESCE(?, category),
          is_vip_only = COALESCE(?, is_vip_only),
          is_active = COALESCE(?, is_active),
          model_multiplier_enabled = COALESCE(?, model_multiplier_enabled),
          updated_at = datetime('now')
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
    await c.env.DB.prepare('DELETE FROM credit_features WHERE feature_key = ?').bind(key).run();
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
    const { results } = await c.env.DB.prepare(`
      SELECT fmm.*, m.model_name, m.provider, cf.name as feature_name
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

    await c.env.DB.prepare(`
      INSERT INTO feature_model_mappings (feature_key, model_id, temperature)
      VALUES (?, ?, ?)
      ON CONFLICT(feature_key) DO UPDATE SET
        model_id = excluded.model_id,
        temperature = excluded.temperature,
        updated_at = CURRENT_TIMESTAMP
    `).bind(featureKey, modelId, temperature || 0.7).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==========================================
// Model Registry Management
// ==========================================

// Get all models
adminRoutes.get('/model-registry', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM model_registry ORDER BY is_default DESC, provider, model_name'
    ).all();
    // Mask API keys for display
    const masked = (results || []).map((m: any) => ({
      ...m,
      api_key_encrypted: m.api_key_encrypted
        ? `${m.api_key_encrypted.slice(0, 8)}...${m.api_key_encrypted.slice(-4)}`
        : null,
    }));
    return c.json({ success: true, models: masked });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create model
adminRoutes.post('/model-registry', async (c) => {
  try {
    const { provider, modelName, displayName, apiKey, baseUrl, creditMultiplier, capabilities, configJson } = await c.req.json();
    if (!provider || !modelName || !displayName) {
      return c.json({ success: false, error: 'provider, modelName, displayName 不能为空' }, 400);
    }

    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO model_registry (id, provider, model_name, display_name, api_key_encrypted, base_url, credit_multiplier, capabilities, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, provider, modelName, displayName,
      apiKey || null, baseUrl || null,
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

    // Build dynamic update
    const updates: string[] = [];
    const values: any[] = [];

    if (body.displayName !== undefined) { updates.push('display_name = ?'); values.push(body.displayName); }
    if (body.provider !== undefined) { updates.push('provider = ?'); values.push(body.provider); }
    if (body.modelName !== undefined) { updates.push('model_name = ?'); values.push(body.modelName); }
    if (body.apiKey !== undefined) { updates.push('api_key_encrypted = ?'); values.push(body.apiKey || null); }
    if (body.baseUrl !== undefined) { updates.push('base_url = ?'); values.push(body.baseUrl || null); }
    if (body.creditMultiplier !== undefined) { updates.push('credit_multiplier = ?'); values.push(body.creditMultiplier); }
    if (body.capabilities !== undefined) { updates.push('capabilities = ?'); values.push(JSON.stringify(body.capabilities)); }
    if (body.isActive !== undefined) { updates.push('is_active = ?'); values.push(body.isActive ? 1 : 0); }
    if (body.configJson !== undefined) { updates.push('config_json = ?'); values.push(JSON.stringify(body.configJson)); }

    // Handle default model: only one can be default
    if (body.isDefault !== undefined) {
      if (body.isDefault) {
        await c.env.DB.prepare('UPDATE model_registry SET is_default = 0').run();
      }
      updates.push('is_default = ?');
      values.push(body.isDefault ? 1 : 0);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await c.env.DB.prepare(`
      UPDATE model_registry SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete model
adminRoutes.delete('/model-registry/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM model_registry WHERE id = ?').bind(id).run();
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
    const totalCredit = await c.env.DB.prepare(
      'SELECT SUM(credit_balance) as total FROM users'
    ).first() as any;

    const totalConsumed = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM credit_transactions WHERE type = 'consume'"
    ).first() as any;

    const totalRecharged = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions WHERE type IN ('recharge', 'reward')"
    ).first() as any;

    const topFeatures = await c.env.DB.prepare(`
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
        topFeatures: topFeatures.results || [],
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
    const user = await c.env.DB.prepare(
      'SELECT credit_balance FROM users WHERE id = ?'
    ).bind(userId).first() as any;

    if (!user) {
      return c.json({ success: false, error: '用户不存在' }, 404);
    }

    const balanceAfter = (user.credit_balance || 0) + amount;

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET credit_balance = ? WHERE id = ?').bind(balanceAfter, userId),
      c.env.DB.prepare(`
        INSERT INTO credit_transactions (user_id, feature_key, amount, balance_after, type, description)
        VALUES (?, NULL, ?, ?, 'recharge', ?)
      `).bind(userId, amount, balanceAfter, description || '管理员充值'),
    ]);

    return c.json({ success: true, balanceAfter });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

export { adminRoutes };
