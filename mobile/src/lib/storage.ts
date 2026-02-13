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
  
  // Load AI config
  const aiProvider = await AsyncStorage.getItem(STORAGE_KEYS.aiProvider);
  const aiModel = await AsyncStorage.getItem(STORAGE_KEYS.aiModel);
  const aiBaseUrl = await AsyncStorage.getItem(STORAGE_KEYS.aiBaseUrl);
  const aiApiKey = Platform.OS === 'web' 
    ? await AsyncStorage.getItem(SECURE_KEYS.aiApiKey)
    : await SecureStore.getItemAsync(SECURE_KEYS.aiApiKey);

  const config: AppConfig = {
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrlRaw || DEFAULT_API_BASE_URL),
  };

  if (aiProvider && aiModel) {
    config.ai = {
      provider: aiProvider,
      model: aiModel,
      baseUrl: aiBaseUrl || undefined,
      apiKey: aiApiKey || undefined,
    };
  }

  return config;
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.apiBaseUrl, normalizeApiBaseUrl(config.apiBaseUrl));
  
  if (config.ai) {
    await AsyncStorage.setItem(STORAGE_KEYS.aiProvider, config.ai.provider);
    await AsyncStorage.setItem(STORAGE_KEYS.aiModel, config.ai.model);
    if (config.ai.baseUrl) {
      await AsyncStorage.setItem(STORAGE_KEYS.aiBaseUrl, config.ai.baseUrl);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.aiBaseUrl);
    }
    
    if (config.ai.apiKey) {
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(SECURE_KEYS.aiApiKey, config.ai.apiKey);
      } else {
        await SecureStore.setItemAsync(SECURE_KEYS.aiApiKey, config.ai.apiKey);
      }
    } else {
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem(SECURE_KEYS.aiApiKey);
      } else {
        await SecureStore.deleteItemAsync(SECURE_KEYS.aiApiKey);
      }
    }
  } else {
     // If ai config is removed/cleared, clean up storage
    await AsyncStorage.removeItem(STORAGE_KEYS.aiProvider);
    await AsyncStorage.removeItem(STORAGE_KEYS.aiModel);
    await AsyncStorage.removeItem(STORAGE_KEYS.aiBaseUrl);
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(SECURE_KEYS.aiApiKey);
    } else {
      await SecureStore.deleteItemAsync(SECURE_KEYS.aiApiKey);
    }
  }
}

export function sanitizeAppConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
  };
}
