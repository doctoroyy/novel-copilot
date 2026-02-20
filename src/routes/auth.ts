import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { signToken, hashPassword, verifyPassword, authMiddleware } from '../middleware/authMiddleware.js';

export const authRoutes = new Hono<{ Bindings: Env }>();

// Register with invitation code
authRoutes.post('/register', async (c) => {
  try {
    const { username, password, invitationCode } = await c.req.json();

    // Validate input
    if (!username || !password || !invitationCode) {
      return c.json({ success: false, error: '请填写完整信息' }, 400);
    }

    if (username.length < 2 || username.length > 20) {
      return c.json({ success: false, error: '用户名长度需要 2-20 个字符' }, 400);
    }

    if (password.length < 6) {
      return c.json({ success: false, error: '密码至少需要 6 个字符' }, 400);
    }

    // Check invitation code
    const code = await c.env.DB.prepare(`
      SELECT code, used_by, expires_at FROM invitation_codes WHERE code = ?
    `).bind(invitationCode).first();

    if (!code) {
      return c.json({ success: false, error: '邀请码无效' }, 400);
    }

    if ((code as any).used_by) {
      return c.json({ success: false, error: '邀请码已被使用' }, 400);
    }

    if ((code as any).expires_at && new Date((code as any).expires_at) < new Date()) {
      return c.json({ success: false, error: '邀请码已过期' }, 400);
    }

    // Check if username exists
    const existingUser = await c.env.DB.prepare(`
      SELECT id FROM users WHERE username = ?
    `).bind(username).first();

    if (existingUser) {
      return c.json({ success: false, error: '用户名已存在' }, 400);
    }

    // Create user
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await c.env.DB.prepare(`
      INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)
    `).bind(userId, username, passwordHash).run();

    // Mark invitation code as used
    await c.env.DB.prepare(`
      UPDATE invitation_codes SET used_by = ?, used_at = (unixepoch() * 1000) WHERE code = ?
    `).bind(userId, invitationCode).run();

    // Generate token
    const token = await signToken({ userId, username });

    return c.json({
      success: true,
      user: { id: userId, username },
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Login
authRoutes.post('/login', async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password) {
      return c.json({ success: false, error: '请填写用户名和密码' }, 400);
    }

    // Find user
    const user = await c.env.DB.prepare(`
      SELECT id, username, password_hash, role, allow_custom_provider FROM users WHERE username = ?
    `).bind(username).first();

    if (!user) {
      return c.json({ success: false, error: '用户名或密码错误' }, 401);
    }

    // Verify password
    const isValid = await verifyPassword(password, (user as any).password_hash);

    if (!isValid) {
      return c.json({ success: false, error: '用户名或密码错误' }, 401);
    }

    // Update last login
    await c.env.DB.prepare(`
      UPDATE users SET last_login_at = (unixepoch() * 1000) WHERE id = ?
    `).bind((user as any).id).run();

    // Generate token
    const token = await signToken({
      userId: (user as any).id,
      username: (user as any).username,
    });

    return c.json({
      success: true,
      user: {
        id: (user as any).id,
        username: (user as any).username,
        role: (user as any).role || 'user',
        allowCustomProvider: !!(user as any).allow_custom_provider,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get current user (requires auth)
authRoutes.get('/me', authMiddleware(), async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ success: false, error: '未登录' }, 401);
  }

  // Get full user info from DB
  const dbUser = await c.env.DB.prepare(`
    SELECT id, username, role, credit_balance, allow_custom_provider, vip_type, level, created_at, last_login_at FROM users WHERE id = ?
  `).bind(user.userId).first();

  if (!dbUser) {
    return c.json({ success: false, error: '用户不存在' }, 404);
  }

  return c.json({
    success: true,
    user: {
      id: (dbUser as any).id,
      username: (dbUser as any).username,
      role: (dbUser as any).role || 'user',
      creditBalance: (dbUser as any).credit_balance ?? 150,
      allowCustomProvider: !!(dbUser as any).allow_custom_provider,
      vipType: (dbUser as any).vip_type || 'free',
      level: (dbUser as any).level ?? 1,
      createdAt: (dbUser as any).created_at,
      lastLoginAt: (dbUser as any).last_login_at,
    },
  });
});

// Logout (client-side, just return success)
authRoutes.post('/logout', async (c) => {
  return c.json({ success: true });
});

// Check if any users exist (for first-time setup)
authRoutes.get('/status', async (c) => {
  const result = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first();
  const hasUsers = (result as any)?.count > 0;

  return c.json({
    success: true,
    hasUsers,
  });
});

// Google OAuth - Redirect to Google
authRoutes.get('/google', async (c) => {
  // @ts-ignore - environment variable
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return c.json({ success: false, error: 'Google OAuth not configured' }, 500);
  }

  // Get the origin from request or use default
  const origin = c.req.header('Origin') || c.req.header('Referer')?.replace(/\/$/, '') || 'https://novel-copilot.doctoroyy.workers.dev';
  const redirectUri = `${origin}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state: origin, // Pass origin as state to use in callback
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return c.redirect(authUrl);
});

// Google OAuth - Callback
authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state'); // This is the origin we passed
  const error = c.req.query('error');

  if (error) {
    return c.redirect(`${state || ''}/login?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return c.redirect(`${state || ''}/login?error=missing_code`);
  }

  try {
    // @ts-ignore - environment variables
    const clientId = c.env.GOOGLE_CLIENT_ID;
    // @ts-ignore
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return c.redirect(`${state || ''}/login?error=oauth_not_configured`);
    }

    const origin = state || 'https://novel-copilot.doctoroyy.workers.dev';
    const redirectUri = `${origin}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData);
      return c.redirect(`${origin}/login?error=token_exchange_failed`);
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userInfoResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    // Check if user exists by google_id
    let user = await c.env.DB.prepare(`
      SELECT id, username, role FROM users WHERE google_id = ?
    `).bind(googleUser.id).first() as any;

    if (!user) {
      // Check if email already exists (link accounts)
      user = await c.env.DB.prepare(`
        SELECT id, username, role FROM users WHERE email = ?
      `).bind(googleUser.email).first() as any;

      if (user) {
        // Link Google account to existing user
        await c.env.DB.prepare(`
          UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?
        `).bind(googleUser.id, googleUser.picture, user.id).run();
      } else {
        // Create new user
        const userId = crypto.randomUUID();
        const username = googleUser.name || googleUser.email.split('@')[0];

        // Ensure unique username
        let finalUsername = username;
        let counter = 1;
        while (true) {
          const existing = await c.env.DB.prepare(`
            SELECT id FROM users WHERE username = ?
          `).bind(finalUsername).first();
          if (!existing) break;
          finalUsername = `${username}${counter++}`;
        }

        await c.env.DB.prepare(`
          INSERT INTO users (id, username, google_id, email, avatar_url, role)
          VALUES (?, ?, ?, ?, ?, 'user')
        `).bind(userId, finalUsername, googleUser.id, googleUser.email, googleUser.picture).run();

        user = { id: userId, username: finalUsername, role: 'user' };
      }
    }

    // Update last login
    await c.env.DB.prepare(`
      UPDATE users SET last_login_at = (unixepoch() * 1000) WHERE id = ?
    `).bind(user.id).run();

    // Generate JWT token
    const token = await signToken({
      userId: user.id,
      username: user.username,
    });

    // Redirect to frontend with token
    return c.redirect(`${origin}/login?token=${token}&username=${encodeURIComponent(user.username)}&role=${user.role || 'user'}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return c.redirect(`${state || ''}/login?error=oauth_failed`);
  }
});

