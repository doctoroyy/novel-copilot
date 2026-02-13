/**
 * Credit 服务
 * 
 * 封装所有 credit 相关操作：查余额、扣费、充值、记录消费流水
 */

export interface CreditFeature {
  feature_key: string;
  name: string;
  description: string | null;
  base_cost: number;
  model_multiplier_enabled: number;
  is_vip_only: number;
  is_active: number;
  category: string;
}

export interface CreditTransaction {
  id: number;
  user_id: string;
  feature_key: string | null;
  amount: number;
  balance_after: number;
  type: 'consume' | 'recharge' | 'reward' | 'refund';
  description: string | null;
  metadata: string | null;
  created_at: string;
}

export interface ModelRegistryEntry {
  id: string;
  provider: string;
  model_name: string;
  display_name: string;
  api_key_encrypted: string | null;
  base_url: string | null;
  credit_multiplier: number;
  capabilities: string;
  is_active: number;
  is_default: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

/**
 * 查询用户 credit 余额
 */
export async function getBalance(db: D1Database, userId: string): Promise<number> {
  const result = await db.prepare(
    'SELECT credit_balance FROM users WHERE id = ?'
  ).bind(userId).first() as any;
  return result?.credit_balance ?? 0;
}

/**
 * 获取功能定价配置
 */
export async function getFeatureCost(db: D1Database, featureKey: string): Promise<CreditFeature | null> {
  const result = await db.prepare(
    'SELECT * FROM credit_features WHERE feature_key = ? AND is_active = 1'
  ).bind(featureKey).first() as any;
  return result || null;
}

/**
 * 获取所有功能定价
 */
export async function getAllFeatures(db: D1Database): Promise<CreditFeature[]> {
  const { results } = await db.prepare(
    'SELECT * FROM credit_features ORDER BY category, feature_key'
  ).all();
  return (results || []) as unknown as CreditFeature[];
}

/**
 * 获取默认模型的 credit 倍率
 */
export async function getDefaultModelMultiplier(db: D1Database): Promise<number> {
  const model = await db.prepare(
    'SELECT credit_multiplier FROM model_registry WHERE is_default = 1 AND is_active = 1 LIMIT 1'
  ).first() as any;
  return model?.credit_multiplier ?? 1.0;
}

/**
 * 计算最终消耗 = baseCost × modelMultiplier
 */
export function calculateCost(baseCost: number, modelMultiplier: number): number {
  return Math.ceil(baseCost * modelMultiplier);
}

/**
 * 消耗 credit
 * 返回扣费后的余额，如果余额不足则抛出错误
 */
export async function consumeCredit(
  db: D1Database,
  userId: string,
  featureKey: string,
  description?: string,
  count: number = 1
): Promise<{ cost: number; balanceAfter: number }> {
  // 查功能定价
  const feature = await getFeatureCost(db, featureKey);
  if (!feature) {
    throw new Error(`未知的功能: ${featureKey}`);
  }

  // 查模型倍率
  let multiplier = 1.0;
  if (feature.model_multiplier_enabled) {
    multiplier = await getDefaultModelMultiplier(db);
  }

  const totalCost = calculateCost(feature.base_cost, multiplier) * count;

  // 查余额
  const balance = await getBalance(db, userId);
  if (balance < totalCost) {
    throw new Error(`创作能量不足，需要 ${totalCost}，当前余额 ${balance}`);
  }

  const balanceAfter = balance - totalCost;

  // 扣费 + 记录流水（原子操作）
  await db.batch([
    db.prepare('UPDATE users SET credit_balance = ? WHERE id = ?').bind(balanceAfter, userId),
    db.prepare(
      `INSERT INTO credit_transactions (user_id, feature_key, amount, balance_after, type, description, metadata)
       VALUES (?, ?, ?, ?, 'consume', ?, ?)`
    ).bind(
      userId,
      featureKey,
      -totalCost,
      balanceAfter,
      description || feature.name,
      JSON.stringify({ count, baseCost: feature.base_cost, multiplier, totalCost })
    ),
  ]);

  return { cost: totalCost, balanceAfter };
}

/**
 * 充值 / 奖励 credit
 */
export async function addCredit(
  db: D1Database,
  userId: string,
  amount: number,
  type: 'recharge' | 'reward' | 'refund',
  description: string
): Promise<{ balanceAfter: number }> {
  const balance = await getBalance(db, userId);
  const balanceAfter = balance + amount;

  await db.batch([
    db.prepare('UPDATE users SET credit_balance = ? WHERE id = ?').bind(balanceAfter, userId),
    db.prepare(
      `INSERT INTO credit_transactions (user_id, feature_key, amount, balance_after, type, description)
       VALUES (?, NULL, ?, ?, ?, ?)`
    ).bind(userId, amount, balanceAfter, type, description),
  ]);

  return { balanceAfter };
}

/**
 * 查询消费记录
 */
export async function getTransactions(
  db: D1Database,
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ transactions: CreditTransaction[]; total: number }> {
  const countResult = await db.prepare(
    'SELECT COUNT(*) as count FROM credit_transactions WHERE user_id = ?'
  ).bind(userId).first() as any;

  const { results } = await db.prepare(
    'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(userId, limit, offset).all();

  return {
    transactions: (results || []) as unknown as CreditTransaction[],
    total: countResult?.count || 0,
  };
}
