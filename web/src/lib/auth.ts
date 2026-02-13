// Authentication API functions and types

const API_BASE = '/api';

export interface User {
  id: string;
  username: string;
  role?: string;
  creditBalance?: number;
  allowCustomProvider?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
}

// Token storage key
const TOKEN_KEY = 'novel_copilot_token';

// Get stored token
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

// Set token
export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

// Remove token
export function removeToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

// Check if user is authenticated (has token)
export function isAuthenticated(): boolean {
  return !!getToken();
}

// Get auth headers
export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add custom AI config if exists
  if (typeof window !== 'undefined') {
    const aiProvider = localStorage.getItem('ai_provider');
    const aiModel = localStorage.getItem('ai_model');
    const aiBaseUrl = localStorage.getItem('ai_base_url');
    const aiApiKey = localStorage.getItem('ai_api_key');

    if (aiProvider) headers['x-custom-provider'] = aiProvider;
    if (aiModel) headers['x-custom-model'] = aiModel;
    if (aiBaseUrl) headers['x-custom-base-url'] = aiBaseUrl;
    if (aiApiKey) headers['x-custom-api-key'] = aiApiKey;
  }
  
  return headers;
}

// Register with invitation code
export async function register(
  username: string,
  password: string,
  invitationCode: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password, invitationCode }),
  });

  const data = await response.json();

  if (data.success && data.token) {
    setToken(data.token);
  }

  return data;
}

// Login
export async function login(
  username: string,
  password: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json();

  if (data.success && data.token) {
    setToken(data.token);
  }

  return data;
}

// Get current user
export async function getCurrentUser(): Promise<AuthResponse> {
  const token = getToken();
  if (!token) {
    return { success: false, error: '未登录' };
  }

  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
    });

    return await response.json();
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// Logout
export async function logout(): Promise<void> {
  removeToken();
  // Optionally call server logout endpoint
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  } catch {
    // Ignore errors, token is already removed
  }
}

// Check if any users exist (for first-time setup)
export async function checkAuthStatus(): Promise<{ hasUsers: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/auth/status`);
    const data = await response.json();
    return { hasUsers: data.hasUsers || false };
  } catch {
    return { hasUsers: false };
  }
}
