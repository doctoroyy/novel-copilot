import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RECOVERY_MARKER_PREFIX = 'chunk-load-recovery:';
const RECOVERABLE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
];

let reloadTriggered = false;

type ModuleWithDefault<T extends ComponentType<any>> = {
  default: T;
};

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return [error.name, error.message].filter(Boolean).join(': ');
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return '';
}

function getRecoveryKey(error: unknown, source: string): string {
  const message = getErrorMessage(error) || source;
  return `${RECOVERY_MARKER_PREFIX}${message}`;
}

export function isRecoverableChunkLoadError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return RECOVERABLE_PATTERNS.some((pattern) => pattern.test(message));
}

export function recoverFromChunkLoadError(error: unknown, source: string): boolean {
  if (typeof window === 'undefined' || !isRecoverableChunkLoadError(error)) {
    return false;
  }

  const recoveryKey = getRecoveryKey(error, source);
  if (reloadTriggered || sessionStorage.getItem(recoveryKey)) {
    return false;
  }

  reloadTriggered = true;
  sessionStorage.setItem(recoveryKey, '1');
  window.location.reload();
  return true;
}

export function lazyWithRecovery<T extends ComponentType<any>>(
  source: string,
  loader: () => Promise<ModuleWithDefault<T>>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await loader();
    } catch (error) {
      if (recoverFromChunkLoadError(error, source)) {
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}

export function installChunkLoadRecovery(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const handleRecoverableError = (error: unknown, source: string, event?: { preventDefault?: () => void }) => {
    if (!isRecoverableChunkLoadError(error)) {
      return;
    }

    event?.preventDefault?.();
    recoverFromChunkLoadError(error, source);
  };

  window.addEventListener('vite:preloadError', (event) => {
    const viteEvent = event as Event & {
      payload?: unknown;
    };
    handleRecoverableError(viteEvent.payload, 'vite:preloadError', viteEvent);
  });

  window.addEventListener('error', (event) => {
    handleRecoverableError(event.error ?? event.message, 'window:error', event);
  });

  window.addEventListener('unhandledrejection', (event) => {
    handleRecoverableError(event.reason, 'window:unhandledrejection', event);
  });
}
