// Re-export everything from the new context for backward compatibility
export { 
  useAIConfig, 
  AIConfigProvider, 
  getAIConfigHeaders, 
  PROVIDER_MODELS 
} from '@/contexts/AIConfigContext';

export type { AIConfig, AIProvider } from '@/contexts/AIConfigContext';
