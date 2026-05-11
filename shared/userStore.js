/**
 * userStore.js
 * ─────────────────────────────────────────────────────────────────
 * In-memory per-user state store for mock services.
 * Each service creates its own instance with its own default config.
 *
 * Handles:
 *   - Per-user service config (online/offline, failureRate, latency)
 *   - Per-user metrics (requests, successes, failures)
 *   - Per-user DLQ messages
 *   - Automatic TTL cleanup (30 min inactivity)
 *   - Concurrency safety (synchronous Map operations in Node.js are atomic)
 *
 * Usage:
 *   const store = new UserStore({ isOffline: false, failureRate: 0, latencyMs: 300 });
 *   const config = store.getConfig(userId);
 *   store.setConfig(userId, { isOffline: true });
 *   store.recordSuccess(userId);
 *   store.recordFailure(userId, "ERP_503", payload);
 *   store.getMetrics(userId);
 *   store.getDlq(userId);
 */
 
const USER_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean every 5 minutes
const MAX_DLQ_PER_USER = 50;
const MAX_USERS = 500; // Safety cap — prevent unbounded memory growth
 
class UserStore {
  constructor(defaultConfig = {}) {
    // Default service config — each service provides its own defaults
    this._defaultConfig = {
      isOffline: false,
      failureRate: 0,
      timeoutRate: 0,
      latencyMs: 0,
      ...defaultConfig,
    };
 
    // Map<userId, UserRecord>
    this._users = new Map();
 
    // Start cleanup timer
    this._cleanupTimer = setInterval(
      () => this._cleanup(),
      CLEANUP_INTERVAL_MS
    );
    // Don't block process exit
    this._cleanupTimer.unref();
  }
 
  // ─── Internal helpers ────────────────────────────────────────
 
  _now() {
    return Date.now();
  }
 
  _defaultRecord() {
    return {
      config: { ...this._defaultConfig },
      metrics: {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        timeoutRequests: 0,
        lastRequestAt: null,
      },
      dlq: [], // Array of { orderId, userId, payload, error, timestamp }
      createdAt: this._now(),
      lastActiveAt: this._now(),
    };
  }
 
  /**
   * Get or create a user record.
   * All access goes through here — guarantees record exists.
   */
  _getOrCreate(userId) {
    if (!this._users.has(userId)) {
      // Safety cap — evict oldest user if at limit
      if (this._users.size >= MAX_USERS) {
        this._evictOldest();
      }
      this._users.set(userId, this._defaultRecord());
    }
    const record = this._users.get(userId);
    record.lastActiveAt = this._now();
    return record;
  }
 
  /**
   * Evict the least-recently-active user when at capacity.
   */
  _evictOldest() {
    let oldestId = null;
    let oldestTime = Infinity;
    for (const [id, record] of this._users.entries()) {
      if (record.lastActiveAt < oldestTime) {
        oldestTime = record.lastActiveAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      this._users.delete(oldestId);
      console.log(`[USER_STORE] Evicted oldest user: ${oldestId}`);
    }
  }
 
  /**
   * Remove users inactive for > TTL.
   * Called automatically every 5 minutes.
   */
  _cleanup() {
    const cutoff = this._now() - USER_TTL_MS;
    let removed = 0;
    for (const [userId, record] of this._users.entries()) {
      if (record.lastActiveAt < cutoff) {
        this._users.delete(userId);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[USER_STORE] Cleaned up ${removed} expired user(s). Active: ${this._users.size}`);
    }
  }
 
  // ─── Config API ──────────────────────────────────────────────
 
  /**
   * Get the current config for a user.
   * Returns default config if user has no record yet.
   */
  getConfig(userId) {
    return { ...this._getOrCreate(userId).config };
  }
 
  /**
   * Update config for a user.
   * Merges with existing config — partial updates are safe.
   */
  setConfig(userId, configPatch) {
    const record = this._getOrCreate(userId);
    record.config = { ...record.config, ...configPatch };
    return { ...record.config };
  }
 
  /**
   * Reset a user's config to service defaults.
   */
  resetConfig(userId) {
    const record = this._getOrCreate(userId);
    record.config = { ...this._defaultConfig };
    return { ...record.config };
  }
 
  /**
   * Reset everything for a user (full clean slate).
   * Used when user explicitly resets their simulation.
   */
  resetUser(userId) {
    this._users.set(userId, this._defaultRecord());
    return this.getState(userId);
  }
 
  // ─── Metrics API ─────────────────────────────────────────────
 
  recordRequest(userId) {
    const record = this._getOrCreate(userId);
    record.metrics.totalRequests++;
    record.metrics.lastRequestAt = new Date().toISOString();
  }
 
  recordSuccess(userId) {
    const record = this._getOrCreate(userId);
    record.metrics.successRequests++;
  }
 
  recordFailure(userId) {
    const record = this._getOrCreate(userId);
    record.metrics.failedRequests++;
  }
 
  recordTimeout(userId) {
    const record = this._getOrCreate(userId);
    record.metrics.timeoutRequests++;
  }
 
  getMetrics(userId) {
    const record = this._getOrCreate(userId);
    const { totalRequests, successRequests, failedRequests, timeoutRequests, lastRequestAt } = record.metrics;
    return {
      totalRequests,
      successRequests,
      failedRequests,
      timeoutRequests,
      successRate: totalRequests > 0
        ? Math.round((successRequests / totalRequests) * 100)
        : 100,
      lastRequestAt,
    };
  }
 
  // ─── DLQ API ─────────────────────────────────────────────────
 
  /**
   * Add a message to the user's DLQ.
   */
  addDlqMessage(userId, { orderId, correlationId, payload, error, failedService, retryCount }) {
    const record = this._getOrCreate(userId);
    const message = {
      messageId: `DLQ-${Date.now().toString(16).toUpperCase()}`,
      userId,
      orderId: orderId || "unknown",
      correlationId: correlationId || "unknown",
      payload: payload || {},
      error: error || "UNKNOWN_ERROR",
      failedService: failedService || "unknown",
      retryCount: retryCount || 0,
      timestamp: new Date().toISOString(),
    };
    // Cap DLQ size per user
    if (record.dlq.length >= MAX_DLQ_PER_USER) {
      record.dlq.shift(); // Remove oldest
    }
    record.dlq.push(message);
    return message;
  }
 
  /**
   * Get all DLQ messages for a user.
   */
  getDlq(userId) {
    const record = this._getOrCreate(userId);
    return [...record.dlq];
  }
 
  /**
   * Get DLQ count for a user.
   */
  getDlqCount(userId) {
    const record = this._getOrCreate(userId);
    return record.dlq.length;
  }
 
  /**
   * Clear DLQ for a user (after replay/review).
   */
  clearDlq(userId) {
    const record = this._getOrCreate(userId);
    record.dlq = [];
  }
 
  // ─── Full state API ──────────────────────────────────────────
 
  /**
   * Get complete state for a user (config + metrics + DLQ summary).
   */
  getState(userId) {
    const record = this._getOrCreate(userId);
    return {
      userId,
      config: { ...record.config },
      metrics: this.getMetrics(userId),
      dlqCount: record.dlq.length,
      createdAt: record.createdAt,
      lastActiveAt: record.lastActiveAt,
    };
  }
 
  /**
   * Get store-level stats (for monitoring/health endpoints).
   */
  getStoreStats() {
    return {
      activeUsers: this._users.size,
      maxUsers: MAX_USERS,
      ttlMinutes: USER_TTL_MS / 60000,
    };
  }
 
  /**
   * Determine if a request should fail based on user config.
   * Returns { shouldFail, reason, statusCode } or { shouldFail: false }.
   *
   * Call this at the start of every request handler.
   */
  shouldFail(userId) {
    const config = this.getConfig(userId);
 
    if (config.isOffline) {
      return {
        shouldFail: true,
        reason: "SERVICE_OFFLINE",
        statusCode: 503,
        message: "Service is currently offline",
      };
    }
 
    if (config.failureRate > 0 && Math.random() < config.failureRate) {
      return {
        shouldFail: true,
        reason: "SIMULATED_FAILURE",
        statusCode: 500,
        message: "Simulated random failure",
      };
    }
 
    if (config.timeoutRate > 0 && Math.random() < config.timeoutRate) {
      return {
        shouldFail: true,
        reason: "SIMULATED_TIMEOUT",
        statusCode: 504,
        message: "Simulated timeout",
        delay: config.latencyMs * 3,
      };
    }
 
    return { shouldFail: false };
  }
 
  /**
   * Get effective latency for a user (0 if not configured).
   */
  getLatency(userId) {
    return this.getConfig(userId).latencyMs || 0;
  }
}
 
module.exports = { UserStore };