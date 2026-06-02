import { loadConfig } from "./deviceConfig";

type CacheEntry = {
  data: any;
  etag?: string;
  cachedAt: number;
};

type Cache = Record<string, CacheEntry>;

export class Api {
  private baseUrl: string;
  private headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  private cache: Cache = {};
  private readonly cacheFile: string;
  private cacheReady: Promise<void>;
  private saveCacheTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.cacheFile = `api-cache-${baseUrl.replace(/[^a-z0-9]/gi, "_")}.json`;
    this.cacheReady = this.loadCache();
  }

  private async loadCache(): Promise<void> {
    if (!window.electronAPI) return;
    try {
      const raw = await window.electronAPI.cacheRead(this.cacheFile);
      if (raw) this.cache = JSON.parse(raw) as Cache;
    } catch {
      this.cache = {};
    }
  }

  private saveCache(): void {
    if (!window.electronAPI) return;
    clearTimeout(this.saveCacheTimer);
    this.saveCacheTimer = setTimeout(() => {
      window.electronAPI!.cacheWrite(this.cacheFile, JSON.stringify(this.cache)).catch(() => {});
    }, 2000); // debounce — batches rapid successive writes into one
  }

  setAuthToken(token: string): void {
    this.headers["Authorization"] = `Bearer ${token}`;
  }

  clearCache(endpoint?: string): void {
    if (endpoint) {
      delete this.cache[endpoint];
    } else {
      this.cache = {};
    }
    this.saveCache();
  }

  private isExpired(cachedAt: number, ttl: number): boolean {
    return Date.now() - cachedAt > ttl;
  }

  private async rawFetch(endpoint: string, options: RequestInit = {}, timeoutMs = 3000): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: options.signal ?? controller.signal,
        headers: {
          ...this.headers,
          ...(options.headers as Record<string, string>),
        },
      });
      clearTimeout(timerId);
      return res;
    } catch (err) {
      clearTimeout(timerId);
      throw new Error(
        `Network error on ${options.method ?? "GET"} ${url}: ${(err as Error).message}`,
      );
    }
  }

  private async parseJSON<T>(method: string, endpoint: string, res: Response): Promise<T> {
    try {
      return await res.json();
    } catch {
      throw new Error(`${method} ${endpoint} returned invalid JSON (status ${res.status})`);
    }
  }

  async getBlob(endpoint: string): Promise<string | null> {
    const { disableCache: noCache } = await loadConfig();
    const cacheKey = `blobs/${endpoint.replace(/[^a-z0-9]/gi, "_")}`;

    if (!noCache && window.electronAPI) {
      try {
        const cached = await window.electronAPI.cacheRead(cacheKey);
        if (cached) {
          const [header, b64] = cached.split(",");
          const mimeType = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        }
      } catch (e) {
        console.error("[getBlob] cache parse failed:", e);
      }
    }

    const res = await this.rawFetch(endpoint);
    if (!res.ok) return null;

    const blob = await res.blob();

    if (!noCache && window.electronAPI) {
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      })
        .then((dataUrl) => window.electronAPI!.cacheWrite(cacheKey, dataUrl))
        .catch(() => {});
    }

    return URL.createObjectURL(blob);
  }

  async get<T>(
    endpoint: string,
    options: {
      ttl?: number;
      permanent?: boolean;
    } = {},
  ): Promise<T> {
    await this.cacheReady;

    const { disableCache: noCache, cacheTtlMs: defaultTtl } = await loadConfig();
    const { ttl = defaultTtl, permanent = false } = options;
    const cached = this.cache[endpoint];

    if (!noCache && permanent && cached) return cached.data;
    if (!noCache && cached && !this.isExpired(cached.cachedAt, ttl)) return cached.data;

    const conditionalHeaders: Record<string, string> = {};
    if (!noCache && cached?.etag) {
      conditionalHeaders["If-None-Match"] = cached.etag;
    }

    let res: Response;
    try {
      res = await this.rawFetch(endpoint, { headers: conditionalHeaders });
    } catch (err) {
      if (!noCache && cached) {
        console.warn(`GET ${endpoint} network error or timeout, returning stale cache`);
        return cached.data;
      }
      throw err;
    }

    if (res.status === 304 && cached) {
      this.cache[endpoint].cachedAt = Date.now();
      this.saveCache();
      return cached.data;
    }

    if (!res.ok) {
      // Stale cache fallback only on server errors (5xx), not client errors (4xx)
      if (!noCache && res.status >= 500 && cached) {
        console.warn(`GET ${endpoint} failed with ${res.status}, returning stale cache`);
        return cached.data;
      }
      throw new Error(`GET ${endpoint} failed: ${res.status} ${res.statusText}`);
    }

    const data = await this.parseJSON<T>("GET", endpoint, res);

    if (!noCache) {
      this.cache[endpoint] = {
        data,
        etag: res.headers.get("ETag") ?? undefined,
        cachedAt: Date.now(),
      };
      this.saveCache();
    }

    return data;
  }

  private async send<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const res = await this.rawFetch(endpoint, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      throw new Error(`${method} ${endpoint} failed: ${res.status} ${res.statusText}`);
    }

    return this.parseJSON<T>(method, endpoint, res);
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.send("POST", endpoint, body);
  }

  async put<T>(endpoint: string, body: unknown): Promise<T> {
    return this.send("PUT", endpoint, body);
  }

  async patch<T>(endpoint: string, body: unknown): Promise<T> {
    return this.send("PATCH", endpoint, body);
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.send("DELETE", endpoint);
  }
}

let _api: Api | null = null;

export function initApi(baseUrl: string): void {
  _api = new Api(baseUrl);
}

export function getApi(): Api {
  if (!_api) throw new Error("[api] not initialized – call initApi() before rendering");
  return _api;
}
