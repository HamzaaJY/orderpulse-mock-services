const express = require("express");
const cors = require("cors");
const { UserStore } = require("../../../shared/userStore");
const { userMiddleware, ANONYMOUS_ID } = require("../../../shared/userMiddleware");

const app = express();
const PORT = process.env.PORT || 3003;
const SERVICE_NAME = "WAREHOUSE";

// ── User Store (Shared Logic with CRM/ERP) ────────────────────────
const store = new UserStore({
  isOffline: false,
  failureRate: 0,
  timeoutRate: 0,
  latencyMs: 300,
});

// Per-user fulfillment records: Map<userId, fulfillment[]>
const userFulfillments = new Map();

const getFulfillments = (userId) => {
  if (!userFulfillments.has(userId)) userFulfillments.set(userId, []);
  return userFulfillments.get(userId);
};

// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(userMiddleware); // Captures x-user-id from your Mule header

// Simulated Latency
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
    error: { message, code: statusCode, type: reason, service: SERVICE_NAME },
  });
};

// ── Routes ───────────────────────────────────────────────────────

// POST /api/warehouse/config/failure-rate (UI Control)
app.post("/api/warehouse/config/failure-rate", (req, res) => {
  const config = store.setConfig(req.userId, req.body);
  res.json({ success: true, userId: req.userId, config });
});

// POST /api/warehouse/notifications (The MuleSoft Endpoint)
app.post("/api/warehouse/notify", (req, res) => {
  const userId = req.userId;
  const correlationId = req.headers["x-correlation-id"];

  store.recordRequest(userId);

  // Check if system is toggled off for THIS user
  const failure = store.shouldFail(userId);
  if (failure.shouldFail) {
    return failResponse(res, userId, failure.reason, failure.statusCode, "Warehouse offline");
  }

  // Extract fields from your DataWeave payload
  const { orderId, sku, quantity, customerId, priority } = req.body;

  const fulfillmentRecord = {
    fulfillmentId: `WHS-FLF-${Date.now()}`,
    orderId,
    sku,
    quantity,
    customerId,
    priority: priority || "NORMAL",
    status: "PICKING_QUEUED",
    processedAt: new Date().toISOString()
  };

  // Record in user-isolated history
  getFulfillments(userId).push(fulfillmentRecord);

  store.recordSuccess(userId);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId,
    data: fulfillmentRecord
  });
});

// GET /api/warehouse/status/:orderId
app.get("/api/warehouse/status/:orderId", (req, res) => {
  const userId = req.userId; // Provided by your userMiddleware
  const { orderId } = req.params;

  store.recordRequest(userId);

  // Retrieve the list of fulfillments for this user
  const fulfillments = getFulfillments(userId);
  
  // Find the specific order in the list
  const record = fulfillments.find(f => f.orderId === orderId);

  if (!record) {
    return res.status(404).json({
      success: false,
      error: { 
        message: `Order ${orderId} not found in warehouse inventory`, 
        code: 404, 
        service: SERVICE_NAME 
      },
    });
  }

  store.recordSuccess(userId);
  res.json({
    success: true,
    data: record
  });
});

// GET /api/metrics (UI Dashboard)
app.get("/api/metrics", (req, res) => {
  res.json({
    success: true,
    data: { userId: req.userId, service: SERVICE_NAME, ...store.getMetrics(req.userId) },
  });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Listening on :${PORT} (Multi-tenant Mode)`);
});

module.exports = app;