const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { UserStore } = require("../../../shared/userStore");
const { userMiddleware, ANONYMOUS_ID } = require("../../../shared/userMiddleware");
 
const app = express();
const PORT = process.env.PORT || 3004;
 
const store = new UserStore({
  isOffline: false,
  failureRate: 0,
  timeoutRate: 0,
  latencyMs: 150,
});
 
// Per-user analytics: Map<userId, { events[], revenue, orders }>
const userAnalytics = new Map();
 
const getUserAnalytics = (userId) => {
  if (!userAnalytics.has(userId)) {
    userAnalytics.set(userId, {
      events: [],
      totalRevenue: 0,
      totalOrders: 0,
      totalItemsSold: 0,
      failedOrders: 0,
      recoveredOrders: 0,
    });
  }
  return userAnalytics.get(userId);
};
 
const MAX_EVENTS_PER_USER = 200;
 
// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(userMiddleware);
 
app.use(async (req, res, next) => {
  if (req.path === "/health") return next();
  const latency = store.getLatency(req.userId);
  if (latency > 0) await new Promise((r) => setTimeout(r, latency));
  next();
});
 
const failResponse = (res, userId, reason, statusCode, message) => {
  store.recordRequest(userId);
  store.recordFailure(userId);
  return res.status(statusCode).json({
    success: false,
    timestamp: new Date().toISOString(),
    correlationId: null,
    error: { message, code: statusCode, type: reason, retryable: statusCode >= 500, service: "ANALYTICS" },
  });
};
 
// ── Routes ───────────────────────────────────────────────────────
 
app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "OrderPulse Analytics Service",
      status: "OPERATIONAL",
      version: "1.0.0",
      uptime: process.uptime(),
      activeUsers: store.getStoreStats().activeUsers,
      config: store.getConfig(ANONYMOUS_ID),
    },
  });
});
 
// POST /api/analytics/config/failure-rate — per-user config
app.post("/api/analytics/config/failure-rate", (req, res) => {
  const userId = req.userId;
  const { isOffline, failureRate, timeoutRate, latencyMs } = req.body;
 
  const patch = {};
  if (isOffline !== undefined) patch.isOffline = Boolean(isOffline);
  if (failureRate !== undefined) patch.failureRate = Number(failureRate);
  if (timeoutRate !== undefined) patch.timeoutRate = Number(timeoutRate);
  if (latencyMs !== undefined) patch.latencyMs = Number(latencyMs);
 
  const config = store.setConfig(userId, patch);
 
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: {
      message: "Analytics failure configuration updated",
      userId,
      config: {
        failureRate: `${config.failureRate * 100}%`,
        timeoutRate: `${config.timeoutRate * 100}%`,
        latencyMs: config.latencyMs,
        isOffline: config.isOffline,
      },
    },
  });
});
 
// POST /api/analytics/track — record an event
app.post("/api/analytics/track", (req, res) => {
  const userId = req.userId;
  const {
    eventType, orderId, customerId, customerTier,
    sku, quantity, orderValue, channel, metadata, correlationId,
  } = req.body;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode,
      "Analytics service unavailable");
  }
 
  const analytics = getUserAnalytics(userId);
 
  const event = {
    eventId: `EVT-${uuidv4().slice(0, 8).toUpperCase()}`,
    userId,
    orderId:       orderId       || null,
    customerId:    customerId    || null,
    customerTier:  customerTier  || "STANDARD",
    sku:           sku           || null,
    quantity:      quantity      || 0,
    orderValue:    orderValue    || 0,
    eventType:     eventType     || "UNKNOWN",
    channel:       channel       || "MULESOFT_INTEGRATION",
    metadata:      metadata      || {},
    correlationId: correlationId || null,
    timestamp:     new Date().toISOString(),
  };
 
  // Cap events per user
  if (analytics.events.length >= MAX_EVENTS_PER_USER) {
    analytics.events.shift();
  }
  analytics.events.push(event);
 
  // Update per-user counters
  if (eventType === "ORDER_COMPLETED" || eventType === "ORDER_RECEIVED") {
    analytics.totalRevenue  += orderValue  || 0;
    analytics.totalOrders   += 1;
    analytics.totalItemsSold += quantity   || 0;
  } else if (eventType === "ORDER_FAILED") {
    analytics.failedOrders  += 1;
  } else if (eventType === "ORDER_RECOVERED") {
    analytics.recoveredOrders += 1;
  }
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: { eventId: event.eventId, eventType, recorded: true },
  });
});
 
// GET /api/analytics/events — per-user events
app.get("/api/analytics/events", (req, res) => {
  const userId = req.userId;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode, "Analytics unavailable");
  }
 
  const analytics = getUserAnalytics(userId);
  const events = [...analytics.events].reverse(); // newest first
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: { total: events.length, showing: events.length, events },
  });
});
 
// GET /api/analytics/metrics — per-user aggregated metrics
app.get("/api/analytics/metrics", (req, res) => {
  const userId = req.userId;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode, "Analytics unavailable");
  }
 
  const analytics = getUserAnalytics(userId);
  const { totalRevenue, totalOrders, totalItemsSold, failedOrders, recoveredOrders, events } = analytics;
 
  const averageOrderValue = totalOrders > 0
    ? Math.round((totalRevenue / totalOrders) * 100) / 100
    : 0;
 
  const successRate = (totalOrders + failedOrders) > 0
    ? Math.round((totalOrders / (totalOrders + failedOrders)) * 100)
    : 100;
 
  const recoveryRate = failedOrders > 0
    ? Math.round((recoveredOrders / failedOrders) * 100)
    : 100;
 
  // Revenue breakdown by customer tier
  const revenueByTier = {};
  const revenueByProduct = {};
  const ordersByHour = {};
 
  for (const event of events) {
    if (event.eventType === "ORDER_COMPLETED" || event.eventType === "ORDER_RECEIVED") {
      // By tier
      const tier = event.customerTier || "STANDARD";
      revenueByTier[tier] = (revenueByTier[tier] || 0) + (event.orderValue || 0);
 
      // By product
      if (event.sku) {
        revenueByProduct[event.sku] = (revenueByProduct[event.sku] || 0) + (event.orderValue || 0);
      }
 
      // By hour
      const hour = new Date(event.timestamp).getHours().toString();
      ordersByHour[hour] = (ordersByHour[hour] || 0) + 1;
    }
  }
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      userId,
      realtime: {
        totalRevenue,
        totalOrders,
        totalItemsSold,
        averageOrderValue,
        successRate,
        recoveryRate,
      },
      breakdown: {
        revenueByCustomerTier: revenueByTier,
        revenueByProduct,
        ordersByHour,
      },
      reliability: {
        successfulOrders: totalOrders,
        failedOrders,
        recoveredOrders,
      },
    },
  });
});
 
// GET /api/analytics/dlq — per-user DLQ messages
app.get("/api/analytics/dlq", (req, res) => {
  const userId = req.userId;
 
  store.recordRequest(userId);
 
  const dlqMessages = store.getDlq(userId);
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: {
      userId,
      total: dlqMessages.length,
      messages: dlqMessages,
    },
  });
});
 
// POST /api/analytics/dlq — add a DLQ message for this user
app.post("/api/analytics/dlq", (req, res) => {
  const userId = req.userId;
  const { orderId, correlationId, payload, error, failedService, retryCount } = req.body;
 
  store.recordRequest(userId);
 
  const message = store.addDlqMessage(userId, {
    orderId,
    correlationId,
    payload,
    error,
    failedService,
    retryCount,
  });
 
  // Also record as a failed order event
  const analytics = getUserAnalytics(userId);
  analytics.failedOrders += 1;
  analytics.events.push({
    eventId: `EVT-${uuidv4().slice(0, 8).toUpperCase()}`,
    userId,
    orderId: orderId || null,
    eventType: "ORDER_FAILED",
    channel: "DLQ",
    metadata: { failedService, retryCount, error },
    correlationId: correlationId || null,
    timestamp: new Date().toISOString(),
  });
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: { message, dlqCount: store.getDlqCount(userId) },
  });
});
 
// GET /api/metrics — service-level metrics for this user
app.get("/api/metrics", (req, res) => {
  res.json({
    success: true,
    data: {
      userId: req.userId,
      service: "ANALYTICS",
      ...store.getMetrics(req.userId),
      storeStats: store.getStoreStats(),
    },
  });
});
 
// POST /api/reset — full reset for this user
app.post("/api/reset", (req, res) => {
  const userId = req.userId;
  store.resetUser(userId);
  userAnalytics.delete(userId);
  res.json({ success: true, message: "Analytics state reset for user", userId });
});
 
app.listen(PORT, () => {
  console.log(`[ANALYTICS] Service running on :${PORT}`);
  console.log(`[ANALYTICS] Per-user isolation: ENABLED`);
});
 
module.exports = app;
 
