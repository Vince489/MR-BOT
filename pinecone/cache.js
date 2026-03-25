import { config } from './config.js';

class EmbeddingCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || config.get('caching.ttl') * 1000; // Convert seconds to milliseconds
    this.maxSize = options.maxSize || config.get('caching.maxItems');
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      this.evictions++;
      this.misses++;
      return null;
    }

    this.hits++;
    return item.value;
  }

  set(key, value) {
    // Enforce max size
    if (this.cache.size >= this.maxSize) {
      // Simple LRU eviction - in production would use proper LRU
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.evictions++;
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  getMetrics() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses || 1),
      evictions: this.evictions
    };
  }

  logMetrics() {
    const metrics = this.getMetrics();
    console.log('[Cache Metrics]', {
      timestamp: new Date().toISOString(),
      ...metrics
    });
    return metrics;
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  invalidateSession(sessionId) {
    let count = 0;
    for (const [key, item] of this.cache) {
      if (key.includes(`"${sessionId}"`)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  invalidateByPattern(pattern) {
    let count = 0;
    for (const [key, item] of this.cache) {
      if (key.match(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  invalidateAll() {
    const count = this.cache.size;
    this.clear();
    return count;
  }
}

export const embeddingCache = new EmbeddingCache();