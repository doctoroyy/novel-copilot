import { Context, Next } from 'hono';
import type { Env } from '../worker.js';

// Simple JWT-like token structure (using base64 encoded JSON + signature)
// For production, consider using a proper JWT library compatible with Workers

const JWT_SECRET = 'novel-copilot-secret-key-change-in-production';
const TOKEN_EXPIRY_HOURS = 24 * 7; // 7 days

interface TokenPayload {
  userId: string;
  username: string;
  exp: number;
}

// Extend Hono context with user info
declare module 'hono' {
  interface ContextVariableMap {
    user: TokenPayload | null;
    userId: string | null;
  }
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

export async function signToken(payload: Omit<TokenPayload, 'exp'>): Promise<string> {
  const exp = Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
  const fullPayload: TokenPayload = { ...payload, exp };
  
  const payloadStr = base64UrlEncode(JSON.stringify(fullPayload));
  
  // Create HMAC signature using Web Crypto API
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr));
  const signature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  
  return `${payloadStr}.${signature}`;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const [payloadStr, signature] = token.split('.');
    if (!payloadStr || !signature) return null;
    
    // Verify signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signatureBytes = Uint8Array.from(base64UrlDecode(signature), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payloadStr));
    
    if (!isValid) return null;
    
    // Parse payload
    const payload: TokenPayload = JSON.parse(base64UrlDecode(payloadStr));
    
    // Check expiration
    if (payload.exp < Date.now()) return null;
    
    return payload;
  } catch {
    return null;
  }
}

function allowsQueryTokenForSse(path: string): boolean {
  if (path === '/api/active-tasks') return true;
  return /^\/api\/projects\/[^/]+\/active-task$/.test(path);
}

// Middleware that requires authentication
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const authHeader = c.req.header('Authorization');

    const acceptHeader = c.req.header('Accept') || '';
    const isSseRequest = c.req.method === 'GET'
      && allowsQueryTokenForSse(c.req.path)
      && (c.req.query('stream') === '1' || acceptHeader.includes('text/event-stream'));

    let token: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (isSseRequest) {
      token = c.req.query('token') || null;
    }

    if (!token) {
      return c.json({ success: false, error: '未登录，请先登录' }, 401);
    }

    const payload = await verifyToken(token);
    
    if (!payload) {
      return c.json({ success: false, error: '登录已过期，请重新登录' }, 401);
    }
    
    c.set('user', payload);
    c.set('userId', payload.userId);
    
    await next();
  };
}

// Optional auth middleware - sets user if valid token, but doesn't require it
export function optionalAuthMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = await verifyToken(token);
      
      if (payload) {
        c.set('user', payload);
        c.set('userId', payload.userId);
      } else {
        c.set('user', null);
        c.set('userId', null);
      }
    } else {
      c.set('user', null);
      c.set('userId', null);
    }
    
    await next();
  };
}

// Password hashing using Web Crypto API (PBKDF2)
const SALT_LENGTH = 16;
const ITERATIONS = 100000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256
  );
  
  const hashArray = new Uint8Array(derivedBits);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return false;
    
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    const encoder = new TextEncoder();
    
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: ITERATIONS,
        hash: 'SHA-256',
      },
      key,
      256
    );
    
    const hashArray = new Uint8Array(derivedBits);
    const newHashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return newHashHex === hashHex;
  } catch {
    return false;
  }
}
