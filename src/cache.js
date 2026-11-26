/**
 * Thread-safe is not a concern in Node's single-threaded event loop, but the
 * TTL and size bound still protect us from unbounded memory growth and keep
 * upstream API usage within rate limits.
 */
export class TTLCache {
  constructor(ttlMs = 600_000, maxEntries = 300) {
    this.ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.maxEntries = maxEntries;
    this.store = new Map();
   }

  get enabled() {
    return this.ttlMs > 0;
   }

  get(key) {
    if (!this.enabled) return undefined;
    const found = this.store.get(key);
    if (!found) return undefined;
    if (found.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
     }
    return found.value;
   }

  set(key, value) {
    if (!this.enabled) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
     }
    this.store.set(key, { expiresAt: Date.now() + this.ttlMs, value });
   }

  remember(key, producer) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = producer();
    this.set(key, value);
    return value;
   }

  clear() {
    this.store.clear();
   }
}
