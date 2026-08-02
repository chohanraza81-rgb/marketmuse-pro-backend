import NodeCache from 'node-cache';

class CacheService {
  private cache: NodeCache;

  constructor(ttlSeconds: number = 86400) { // 24h default
    this.cache = new NodeCache({ stdTTL: ttlSeconds, checkperiod: 120 });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  set<T>(key: string, value: T, ttl?: number): void {
    this.cache.set(key, value, ttl ?? undefined);
  }

  del(key: string): void {
    this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
  }
}

export const cacheService = new CacheService();
