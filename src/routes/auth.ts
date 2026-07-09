import { getDb } from '../db/db.js';
import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { signToken, hashPassword, verifyPassword, authMiddleware, getJwtSecret } from '../middleware/authMiddleware.js';

export const authRoutes = new Hono<{ Bindings: Env }>();
const DEFAULT_APP_ORIGIN = 'https://novel-copilot.doctoroyy.workers.dev';

function getRequestOrigin(c: any): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

function normalizeAppOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Register (open registration — invitation codes removed)
authRoutes.post('/register', async (c) => {
  try {
    const { username, password } = await c.req.json();
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';

    // Validate input
    if (!normalizedUsername || !password) {
      return c.json({ success: false, error: '请填写完整信息' }, 400);
    }

    if (normalizedUsername.length < 2 || normalizedUsername.length > 20) {
      return c.json({ success: false, error: '用户名长度需要 2-20 个字符' }, 400);
    }

    if (password.length < 6) {
      return c.json({ success: false, error: '密码至少需要 6 个字符' }, 400);
    }

    // Check if username exists
    const existingUser = getDb().prepare(`
      SELECT id FROM users WHERE username = ?
    `).get(normalizedUsername);

    if (existingUser) {
      return c.json({ success: false, error: '用户名已存在' }, 400);
    }

    // Create user
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    getDb().prepare(`
      INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)
    `).run(userId, normalizedUsername, passwordHash);

    // Generate token
    const token = await signToken({ userId, username: normalizedUsername }, getJwtSecret(c.env));

    return c.json({
      success: true,
      user: { id: userId, username: normalizedUsername },
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
    const user = getDb().prepare(`
      SELECT id, username, password_hash, role FROM users WHERE username = ?
    `).get(username);

    if (!user) {
      return c.json({ success: false, error: '用户名或密码错误' }, 401);
    }

    // Verify password
    const isValid = await verifyPassword(password, (user as any).password_hash);

    if (!isValid) {
      return c.json({ success: false, error: '用户名或密码错误' }, 401);
    }

    // Update last login
    getDb().prepare(`
      UPDATE users SET last_login_at = (unixepoch() * 1000) WHERE id = ?
    `).bind((user as any).id).run();

    // Generate token
    const token = await signToken({
      userId: (user as any).id,
      username: (user as any).username,
    }, getJwtSecret(c.env));

    return c.json({
      success: true,
      user: {
        id: (user as any).id,
        username: (user as any).username,
        role: (user as any).role || 'user',
        allowCustomProvider: true,
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
  const dbUser = getDb().prepare(`
    SELECT id, username, role, credit_balance, vip_type, level, created_at, last_login_at FROM users WHERE id = ?
  `).get(user.userId);

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
      allowCustomProvider: true,
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
  const result = getDb().prepare(`SELECT COUNT(*) as count FROM users`).get();
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

  const origin = getRequestOrigin(c);
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
  const requestOrigin = getRequestOrigin(c);
  const appOrigin = normalizeAppOrigin(state) || requestOrigin;

  if (error) {
    return c.redirect(`${appOrigin}/login?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return c.redirect(`${appOrigin}/login?error=missing_code`);
  }

  try {
    // @ts-ignore - environment variables
    const clientId = c.env.GOOGLE_CLIENT_ID;
    // @ts-ignore
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return c.redirect(`${appOrigin}/login?error=oauth_not_configured`);
    }

    const redirectUri = `${requestOrigin}/api/auth/google/callback`;

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
      return c.redirect(`${appOrigin}/login?error=token_exchange_failed`);
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
    let user = getDb().prepare(`
      SELECT id, username, role FROM users WHERE google_id = ?
    `).get(googleUser.id) as any;

    if (!user) {
      // Check if email already exists (link accounts)
      user = getDb().prepare(`
        SELECT id, username, role FROM users WHERE email = ?
      `).get(googleUser.email) as any;

      if (user) {
        // Link Google account to existing user
        getDb().prepare(`
          UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?
        `).run(googleUser.id, googleUser.picture, user.id);
      } else {
        // Create new user
        const userId = crypto.randomUUID();
        const username = googleUser.name || googleUser.email.split('@')[0];

        // Ensure unique username
        let finalUsername = username;
        let counter = 1;
        while (true) {
          const existing = getDb().prepare(`
            SELECT id FROM users WHERE username = ?
          `).get(finalUsername);
          if (!existing) break;
          finalUsername = `${username}${counter++}`;
        }

        getDb().prepare(`
          INSERT INTO users (id, username, google_id, email, avatar_url, role)
          VALUES (?, ?, ?, ?, ?, 'user')
        `).run(userId, finalUsername, googleUser.id, googleUser.email, googleUser.picture);

        user = { id: userId, username: finalUsername, role: 'user' };
      }
    }

    // Update last login
    getDb().prepare(`
      UPDATE users SET last_login_at = (unixepoch() * 1000) WHERE id = ?
    `).run(user.id);

    // Generate JWT token
    const token = await signToken({
      userId: user.id,
      username: user.username,
    }, getJwtSecret(c.env));

    // Redirect to frontend with token
    return c.redirect(`${appOrigin}/login?token=${token}&username=${encodeURIComponent(user.username)}&role=${user.role || 'user'}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return c.redirect(`${appOrigin}/login?error=oauth_failed`);
  }
});
