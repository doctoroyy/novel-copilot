import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { getBalance, getTransactions, getAllFeatures } from '../services/creditService.js';

export const creditRoutes = new Hono<{ Bindings: Env }>();

// All credit routes require auth
creditRoutes.use('/*', authMiddleware());

// 查询余额 + VIP 信息
creditRoutes.get('/balance', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ success: false, error: '未登录' }, 401);

  try {
    const user = await c.env.DB.prepare(
      'SELECT credit_balance, vip_type, vip_expire_at, level FROM users WHERE id = ?'
    ).bind(userId).first() as any;

    if (!user) return c.json({ success: false, error: '用户不存在' }, 404);

    return c.json({
      success: true,
      creditBalance: user.credit_balance,
      vipType: user.vip_type,
      vipExpireAt: user.vip_expire_at,
      level: user.level,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// 查询消费记录
creditRoutes.get('/transactions', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ success: false, error: '未登录' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const result = await getTransactions(c.env.DB, userId, limit, offset);
    return c.json({ success: true, ...result });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// 获取所有功能定价（用户侧）
creditRoutes.get('/features', async (c) => {
  try {
    const features = await getAllFeatures(c.env.DB);
    // 用户只能看到激活的功能
    const activeFeatures = features.filter(f => f.is_active);
    return c.json({ success: true, features: activeFeatures });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
