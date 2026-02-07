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

export { adminRoutes };
