const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { UserStore } = require("../../../shared/userStore");
const { userMiddleware, ANONYMOUS_ID } = require("../../../shared/userMiddleware");
 
const app = express();
const PORT = process.env.PORT || 3002;
 
const store = new UserStore({
  isOffline: false,
  failureRate: 0,
  timeoutRate: 0,
  latencyMs: 400,
});
 
// ── Base customer profiles (shared read-only) ────────────────────
const BASE_CUSTOMERS = {
  "CUST-001": { customerId: "CUST-001", name: "Apex Dynamics Inc",   email: "procurement@apexdynamics.com", tier: "ENTERPRISE", totalOrders: 47, totalSpend: 89420.50 },
  "CUST-002": { customerId: "CUST-002", name: "Meridian Partners",   email: "orders@meridianpartners.com",  tier: "PREMIUM",    totalOrders: 23, totalSpend: 12840.75 },
  "CUST-003": { customerId: "CUST-003", name: "Northgate Retail",    email: "buying@northgate.com",         tier: "STANDARD",   totalOrders: 8,  totalSpend: 2190.00  },
};
 
// Per-user order history: Map<userId, Map<customerId, orderHistory[]>>
const userOrderHistory = new Map();
 
const getUserHistory = (userId) => {
  if (!userOrderHistory.has(userId)) userOrderHistory.set(userId, new Map());
  return userOrderHistory.get(userId);
};
 
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
    error: { message, code: statusCode, type: reason, retryable: statusCode >= 500, service: "CRM" },
  });
};
 
// ── Routes ───────────────────────────────────────────────────────
 
app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "OrderPulse CRM Service",
      status: "OPERATIONAL",
      version: "1.0.0",
      uptime: process.uptime(),
      activeUsers: store.getStoreStats().activeUsers,
      config: store.getConfig(ANONYMOUS_ID),
    },
  });
});
 
// POST /api/customers/config/failure-rate — per-user config
app.post("/api/customers/config/failure-rate", (req, res) => {
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
      message: "CRM failure configuration updated",
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
 
// GET /api/customers/:customerId
app.get("/api/customers/:customerId", (req, res) => {
  const userId = req.userId;
  const { customerId } = req.params;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode,
      `CRM system is currently ${failure.reason === "SERVICE_OFFLINE" ? "offline" : "experiencing issues"}`);
  }
 
  const customer = BASE_CUSTOMERS[customerId];
  if (!customer) {
    store.recordFailure(userId);
    return res.status(404).json({
      success: false,
      timestamp: new Date().toISOString(),
      correlationId,
      error: { message: `Customer ${customerId} not found`, code: 404, type: "CUSTOMER_NOT_FOUND" },
    });
  }
 
  // Merge base profile with per-user order history
  const history = getUserHistory(userId);
  const userOrders = history.get(customerId) || [];
  const sessionSpend = userOrders.reduce((sum, o) => sum + (o.orderValue || 0), 0);
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      ...customer,
      totalOrders: customer.totalOrders + userOrders.length,
      totalSpend: customer.totalSpend + sessionSpend,
      sessionOrders: userOrders.length,
      lastOrderAt: userOrders.length > 0
        ? userOrders[userOrders.length - 1].orderedAt
        : null,
    },
  });
});
 
// POST /api/customers/:customerId/order-update — saga step 2
app.post("/api/customers/:customerId/order-update", (req, res) => {
  const userId = req.userId;
  const { customerId } = req.params;
  const { orderId, orderValue, sku } = req.body;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode,
      "CRM system cannot process order update");
  }
 
  const customer = BASE_CUSTOMERS[customerId];
  if (!customer) {
    store.recordFailure(userId);
    return res.status(404).json({
      success: false,
      timestamp: new Date().toISOString(),
      correlationId,
      error: { message: `Customer ${customerId} not found`, code: 404, type: "CUSTOMER_NOT_FOUND" },
    });
  }
 
  // Record in per-user history
  const history = getUserHistory(userId);
  const customerHistory = history.get(customerId) || [];
  customerHistory.push({
    orderId,
    orderValue: orderValue || 0,
    sku,
    orderedAt: new Date().toISOString(),
  });
  history.set(customerId, customerHistory);
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      customerId,
      orderId,
      updated: true,
      sessionOrderCount: customerHistory.length,
      journeyTriggered: customer.tier === "ENTERPRISE"
        ? "enterprise-post-purchase-sequence"
        : "standard-post-purchase-sequence",
    },
  });
});
 
// GET /api/customers/:customerId/order-history
app.get("/api/customers/:customerId/order-history", (req, res) => {
  const userId = req.userId;
  const { customerId } = req.params;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode, "CRM unavailable");
  }
 
  const history = getUserHistory(userId);
  const orders = history.get(customerId) || [];
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: { customerId, orders, total: orders.length },
  });
});
 
// GET /api/metrics — per-user
app.get("/api/metrics", (req, res) => {
  res.json({
    success: true,
    data: {
      userId: req.userId,
      service: "CRM",
      ...store.getMetrics(req.userId),
      storeStats: store.getStoreStats(),
    },
  });
});
 
// POST /api/reset
app.post("/api/reset", (req, res) => {
  const userId = req.userId;
  store.resetUser(userId);
  userOrderHistory.delete(userId);
  res.json({ success: true, message: "CRM state reset for user", userId });
});
 
app.listen(PORT, () => {
  console.log(`[CRM] Service running on :${PORT}`);
  console.log(`[CRM] Per-user isolation: ENABLED`);
});
 
module.exports = app;
 