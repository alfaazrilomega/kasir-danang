// Persists browser-side backend connection settings. VPS deployments normally
// keep this empty so the frontend calls the same origin as the Express API.

export const CONFIG_KEY = 'kasir.config.v1';

declare global {
  interface Window {
    KASIR_CONFIG?: Partial<Pick<AppConfig, 'apiBaseUrl'>>;
  }
}

export interface AppConfig {
  /** Backend API base URL. Empty string means same-origin, ideal for VPS deployment. */
  apiBaseUrl: string;
}

const empty: AppConfig = {
  apiBaseUrl: '',
};

export function loadConfig(): AppConfig {
  const bundled = loadBundledConfig();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const stored = { ...empty, ...JSON.parse(raw) } as AppConfig;
      return {
        ...bundled,
        ...stored,
        apiBaseUrl: stored.apiBaseUrl ?? bundled.apiBaseUrl,
      };
    }
  } catch {
    // ignore
  }
  return bundled;
}

function loadBundledConfig(): AppConfig {
  const envApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  const runtime = typeof window !== 'undefined' ? window.KASIR_CONFIG : undefined;
  return {
    ...empty,
    apiBaseUrl: runtime?.apiBaseUrl ?? envApiBaseUrl,
  };
}

export function resetConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

/**
 * Toko tunggal untuk storefront publik (checkout tanpa login). Deployment ini
 * satu toko saja, jadi konstanta ini boleh hardcode dengan fallback —
 * env var dipakai kalau suatu saat perlu dites ke toko lain.
 */
export const PUBLIC_STORE_ID =
  import.meta.env.VITE_PUBLIC_STORE_ID || '5d3e9a20-66ac-4012-9bab-103fbf9b08e4';
