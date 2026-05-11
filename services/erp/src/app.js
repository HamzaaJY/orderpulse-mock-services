
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
 
// ── Shared user infrastructure ──────────────────────────────────
const { UserStore } = require("../../../shared/userStore");
const { userMiddleware, ANONYMOUS_ID } = require("../../../shared/userMiddleware");
 
const app = express();
const PORT = process.env.PORT || 3001;
 
// ERP-specific defaults
const store = new UserStore({
  isOffline: false,
  failureRate: 0,
  timeoutRate: 0,
  latencyMs: 800, // ERP is the slowest service
});
 
// ── Inventory (shared read-only base — reservations are per-user) ─
const BASE_INVENTORY = {
  "SKU-LAPTOP-PRO":   { name: "Professional Laptop",    totalStock: 49,  unitPrice: 1299.99 },
  "SKU-KEYBOARD-MX":  { name: "MX Mechanical Keyboard", totalStock: 120, unitPrice: 129.99  },
  "SKU-HEADSET-PRO":  { name: "Pro Headset",             totalStock: 75,  unitPrice: 249.99  },
  "SKU-WEBCAM-HD":    { name: "HD Webcam",               totalStock: 200, unitPrice: 89.99   },
  "SKU-MONITOR-4K":   { name: "4K Monitor",              totalStock: 30,  unitPrice: 599.99  },
};
 
// Per-user reservations: Map<userId, Map<sku, { reservationId, quantity, orderId }[]>>
const userReservations = new Map();
 
const getUserReservations = (userId) => {
  if (!userReservations.has(userId)) {
    userReservations.set(userId, new Map());
  }
  return userReservations.get(userId);
};
 
const getReservedQuantity = (userId, sku) => {
  const reservations = getUserReservations(userId);
  const skuReservations = reservations.get(sku) || [];
  return skuReservations.reduce((sum, r) => sum + r.quantity, 0);
};
 
// Per-user fulfillment records
const userFulfillments = new Map();
const getUserFulfillments = (userId) => {
  if (!userFulfillments.has(userId)) {
    userFulfillments.set(userId, new Map());
  }
  return userFulfillments.get(userId);
};
 
// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(userMiddleware);
 
// Per-user latency simulation
app.use(async (req, res, next) => {
  if (req.path === "/health") return next();
  const latency = store.getLatency(req.userId);
  if (latency > 0) await new Promise((r) => setTimeout(r, latency));
  next();
});
 
// ── Helper: standard failure response ───────────────────────────
const failResponse = (res, userId, reason, statusCode, message) => {
  store.recordRequest(userId);
  store.recordFailure(userId);
  return res.status(statusCode).json({
    success: false,
    timestamp: new Date().toISOString(),
    correlationId: null,
    error: {
      message,
      code: statusCode,
      type: reason,
      retryable: statusCode >= 500,
      service: "ERP",
    },
  });
};
 
// ── Routes ───────────────────────────────────────────────────────
 
// GET /health
app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "OrderPulse ERP Service",
      status: "OPERATIONAL",
      version: "1.0.0",
      uptime: process.uptime(),
      activeUsers: store.getStoreStats().activeUsers,
      config: store.getConfig(ANONYMOUS_ID),
    },
  });
});
 
// POST /api/fulfillment/config/failure-rate — per-user config
app.post("/api/fulfillment/config/failure-rate", (req, res) => {
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
    correlationId: null,
    data: {
      message: "ERP failure configuration updated",
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
 
// GET /api/fulfillment/config — get current user config
app.get("/api/fulfillment/config", (req, res) => {
  const config = store.getConfig(req.userId);
  res.json({ success: true, data: { userId: req.userId, config } });
});
 
// GET /api/inventory/check/:sku
app.get("/api/inventory/check/:sku", (req, res) => {
  const userId = req.userId;
  const { sku } = req.params;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode,
      `ERP system is currently ${failure.reason === "SERVICE_OFFLINE" ? "offline" : "experiencing issues"}`);
  }
 
  const item = BASE_INVENTORY[sku];
  if (!item) {
    store.recordFailure(userId);
    return res.status(404).json({
      success: false,
      timestamp: new Date().toISOString(),
      correlationId,
      error: { message: `SKU ${sku} not found`, code: 404, type: "SKU_NOT_FOUND" },
    });
  }
 
  const reserved = getReservedQuantity(userId, sku);
  const available = item.totalStock - reserved;
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      sku,
      name: item.name,
      totalStock: item.totalStock,
      reserved,
      available,
      unitPrice: item.unitPrice,
      inStock: available > 0,
    },
  });
});
 
// POST /api/inventory/reserve
app.post("/api/inventory/reserve", (req, res) => {
  const userId = req.userId;
  const { orderId, sku, quantity, customerId } = req.body;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode,
      "ERP system cannot process reservation");
  }
 
  const item = BASE_INVENTORY[sku];
  if (!item) {
    store.recordFailure(userId);
    return res.status(404).json({
      success: false,
      timestamp: new Date().toISOString(),
      correlationId,
      error: { message: `SKU ${sku} not found`, code: 404, type: "SKU_NOT_FOUND" },
    });
  }
 
  const reserved = getReservedQuantity(userId, sku);
  const available = item.totalStock - reserved;
 
  if (quantity > available) {
    store.recordFailure(userId);
    return res.status(409).json({
      success: false,
      timestamp: new Date().toISOString(),
      correlationId,
      error: {
        message: "Insufficient inventory",
        code: 409,
        type: "INSUFFICIENT_STOCK",
        sku,
        requested: quantity,
        available,
      },
    });
  }
 
  // Create per-user reservation
  const reservationId = `RES-${uuidv4().slice(0, 8).toUpperCase()}`;
  const reservations = getUserReservations(userId);
  const skuReservations = reservations.get(sku) || [];
  skuReservations.push({ reservationId, orderId, customerId, quantity, reservedAt: new Date().toISOString() });
  reservations.set(sku, skuReservations);
 
  const totalValue = item.unitPrice * quantity;
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      reservationId,
      orderId,
      sku,
      quantity,
      totalValue,
      reservedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    },
  });
});
 
// POST /api/inventory/release — saga compensation
app.post("/api/inventory/release", (req, res) => {
  const userId = req.userId;
  const { reservationId, orderId } = req.body;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const reservations = getUserReservations(userId);
  let released = false;
 
  for (const [sku, skuReservations] of reservations.entries()) {
    const idx = skuReservations.findIndex(
      (r) => r.reservationId === reservationId || r.orderId === orderId
    );
    if (idx !== -1) {
      skuReservations.splice(idx, 1);
      reservations.set(sku, skuReservations);
      released = true;
      break;
    }
  }
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      released,
      reservationId,
      message: released
        ? "Reservation released — inventory restored"
        : "Reservation not found (may have already expired)",
    },
  });
});
 
// POST /api/fulfillment/trigger
app.post("/api/fulfillment/trigger", (req, res) => {
  const userId = req.userId;
  const { orderId, sku, quantity, customerId } = req.body;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode,
      "ERP fulfillment system unavailable");
  }
 
  const fulfillmentId = `FUL-${uuidv4().slice(0, 8).toUpperCase()}`;
  const fulfillments = getUserFulfillments(userId);
  fulfillments.set(orderId, {
    fulfillmentId,
    orderId,
    sku,
    quantity,
    customerId,
    status: "PROCESSING",
    triggeredAt: new Date().toISOString(),
  });
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: {
      fulfillmentId,
      orderId,
      status: "PROCESSING",
      estimatedShipDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
  });
});
 
// GET /api/fulfillment/status/:orderId
app.get("/api/fulfillment/status/:orderId", (req, res) => {
  const userId = req.userId;
  const { orderId } = req.params;
  const correlationId = req.headers["x-correlation-id"] || null;
 
  store.recordRequest(userId);
 
  const fulfillments = getUserFulfillments(userId);
  const fulfillment = fulfillments.get(orderId);
 
  if (!fulfillment) {
    store.recordSuccess(userId);
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      correlationId,
      data: { status: "PENDING", message: "Order not yet in fulfillment" },
    });
  }
 
  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: { ...fulfillment, status: "PROCESSING" },
  });
});
 
// GET /api/metrics — per-user metrics
app.get("/api/metrics", (req, res) => {
  const userId = req.userId;
  res.json({
    success: true,
    data: {
      userId,
      service: "ERP",
      ...store.getMetrics(userId),
      storeStats: store.getStoreStats(),
    },
  });
});
 
// POST /api/reset — reset this user's ERP state completely
app.post("/api/reset", (req, res) => {
  const userId = req.userId;
  store.resetUser(userId);
  userReservations.delete(userId);
  userFulfillments.delete(userId);
  res.json({ success: true, message: "ERP state reset for user", userId });
});
 
app.listen(PORT, () => {
  console.log(`[ERP] Service running on :${PORT}`);
  console.log(`[ERP] Per-user isolation: ENABLED`);
});
 
module.exports = app;
 