import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SECURE_KEYS, STORAGE_KEYS } from './constants';
import type { AIConfig, AppConfig } from '../types/domain';
import { DEFAULT_AI_MODEL, DEFAULT_AI_PROVIDER, DEFAULT_API_BASE_URL } from './constants';

function normalizeApiBaseUrl(input: string): string {
  let value = input.trim();
  if (!value) return DEFAULT_API_BASE_URL;
  value = value.replace(/\/+$/, '');
  value = value.replace(/\/api$/i, '');
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  return value;
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(SECURE_KEYS.token);
  }
  return SecureStore.getItemAsync(SECURE_KEYS.token);
}

export async function setToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(SECURE_KEYS.token, token);
    return;
  }
  await SecureStore.setItemAsync(SECURE_KEYS.token, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(SECURE_KEYS.token);
    return;
  }
  await SecureStore.deleteItemAsync(SECURE_KEYS.token);
}

export async function loadAppConfig(): Promise<AppConfig> {
  const [
    apiBaseUrlRaw,
    provider,
    model,
    aiBaseUrl,
    apiKey,
  ] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.apiBaseUrl),
    AsyncStorage.getItem(STORAGE_KEYS.aiProvider),
    AsyncStorage.getItem(STORAGE_KEYS.aiModel),
    AsyncStorage.getItem(STORAGE_KEYS.aiBaseUrl),
    Platform.OS === 'web'
      ? AsyncStorage.getItem(SECURE_KEYS.aiApiKey)
      : SecureStore.getItemAsync(SECURE_KEYS.aiApiKey),
  ]);

  return {
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrlRaw || DEFAULT_API_BASE_URL),
    ai: {
      provider: provider || DEFAULT_AI_PROVIDER,
      model: model || DEFAULT_AI_MODEL,
      apiKey: apiKey || '',
      baseUrl: aiBaseUrl || undefined,
    },
  };
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  const secureApiKeyWrite =
    Platform.OS === 'web'
      ? AsyncStorage.setItem(SECURE_KEYS.aiApiKey, config.ai.apiKey)
      : SecureStore.setItemAsync(SECURE_KEYS.aiApiKey, config.ai.apiKey);

  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.apiBaseUrl, normalizeApiBaseUrl(config.apiBaseUrl)),
    AsyncStorage.setItem(STORAGE_KEYS.aiProvider, config.ai.provider),
    AsyncStorage.setItem(STORAGE_KEYS.aiModel, config.ai.model),
    AsyncStorage.setItem(STORAGE_KEYS.aiBaseUrl, config.ai.baseUrl || ''),
    secureApiKeyWrite,
  ]);
}

export function sanitizeAppConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
    ai: {
      ...config.ai,
      provider: config.ai.provider.trim() || DEFAULT_AI_PROVIDER,
      model: config.ai.model.trim() || DEFAULT_AI_MODEL,
      apiKey: config.ai.apiKey.trim(),
      baseUrl: config.ai.baseUrl?.trim() || undefined,
    },
  };
}

export function isAIConfigured(ai: AIConfig): boolean {
  return Boolean(ai.provider && ai.model && ai.apiKey);
}
