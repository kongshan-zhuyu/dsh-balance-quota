/**
 * A Map with a hard entry ceiling and insertion-order eviction.
 *
 * The plugin's two response caches are keyed by provider / source id, so their
 * size is bounded in practice by the number of configured sources. That bound
 * is only safe while every removal path is remembered: a provider deleted by a
 * route the cache never hears about would otherwise leak its entry forever.
 * Evicting the oldest insertion keeps memory flat regardless of churn, and
 * costs one delete on a cache that already misses far more often than it hits.
 *
 * Reads do not refresh insertion order — entries expire by their own recorded
 * timestamp, so LRU promotion would buy nothing and would make eviction order
 * depend on read traffic.
 */
export class BoundedCache extends Map {
  #max;

  constructor(max = 256) {
    super();
    this.#max = Math.max(1, Math.trunc(max));
  }

  set(key, value) {
    // Re-inserting an existing key must not consume a second slot, so drop the
    // old entry first: otherwise a hot key would evict unrelated entries.
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (super.size > this.#max) {
      const oldest = super.keys().next().value;
      if (oldest === undefined) break;
      super.delete(oldest);
    }
    return this;
  }
}
