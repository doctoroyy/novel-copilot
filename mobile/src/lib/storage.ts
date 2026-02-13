import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SECURE_KEYS, STORAGE_KEYS } from './constants';
import type { AppConfig } from '../types/domain';
import { DEFAULT_API_BASE_URL } from './constants';

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
  const apiBaseUrlRaw = await AsyncStorage.getItem(STORAGE_KEYS.apiBaseUrl);

  return {
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrlRaw || DEFAULT_API_BASE_URL),
  };
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.apiBaseUrl, normalizeApiBaseUrl(config.apiBaseUrl));
}

export function sanitizeAppConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
  };
}
