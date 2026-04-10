const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { success, error } = require("../../../../shared/responseHelper");
const { updateConfig } = require("../../../../shared/failureSimulator");
const logger = require("../../../../shared/logger");

// In-memory events store
const events = [];
const metrics = {
  totalRevenue: 0,
  totalOrders: 0,
  totalItemsSold: 0,
  averageOrderValue: 0,
  revenueByCustomerTier: {
    ENTERPRISE: 0,
    PREMIUM: 0,
    STANDARD: 0
  },
  revenueByProduct: {},
  ordersByHour: {},
  successfulOrders: 0,
  failedOrders: 0,
  recoveredOrders: 0
};

// POST track revenue event
router.post("/track", (req, res) => {
  const {
    orderId,
    customerId,
    customerTier,
    sku,
    quantity,
    orderValue,
    eventType,
    channel,
    metadata
  } = req.body;

  if (!orderId || !eventType || !orderValue) {
    return error(res, "Missing required fields: orderId, eventType, orderValue", 400, {
      type: "VALIDATION_ERROR",
      required: ["orderId", "eventType", "orderValue"]
    });
  }

  const eventId = `EVT-${uuidv4().substring(0, 8).toUpperCase()}`;
  const hour = new Date().getHours();

  const event = {
    eventId,
    orderId,
    customerId,
    customerTier: customerTier || "STANDARD",
    sku,
    quantity: quantity || 1,
    orderValue: parseFloat(orderValue),
    eventType,
    channel: channel || "API",
    metadata: metadata || {},
    correlationId: req.headers["x-correlation-id"] || null,
    timestamp: new Date().toISOString()
  };

  events.push(event);

  // Update metrics
  if (eventType === "ORDER_COMPLETED") {
    metrics.totalRevenue += parseFloat(orderValue);
    metrics.totalOrders += 1;
    metrics.totalItemsSold += quantity || 1;
    metrics.averageOrderValue = metrics.totalRevenue / metrics.totalOrders;
    metrics.successfulOrders += 1;

    // Revenue by tier
    const tier = customerTier || "STANDARD";
    metrics.revenueByCustomerTier[tier] =
      (metrics.revenueByCustomerTier[tier] || 0) + parseFloat(orderValue);

    // Revenue by product
    if (sku) {
      metrics.revenueByProduct[sku] =
        (metrics.revenueByProduct[sku] || 0) + parseFloat(orderValue);
    }

    // Orders by hour
    metrics.ordersByHour[hour] = (metrics.ordersByHour[hour] || 0) + 1;
  }

  if (eventType === "ORDER_FAILED") {
    metrics.failedOrders += 1;
  }

  if (eventType === "ORDER_RECOVERED") {
    metrics.recoveredOrders += 1;
  }

  logger.info("ANALYTICS", "Revenue event tracked", {
    eventId,
    orderId,
    eventType,
    orderValue,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, {
    eventId,
    orderId,
    eventType,
    tracked: true,
    timestamp: event.timestamp
  }, 201);
});

// GET real-time metrics dashboard
router.get("/metrics", (req, res) => {
  return success(res, {
    realtime: {
      totalRevenue: parseFloat(metrics.totalRevenue.toFixed(2)),
      totalOrders: metrics.totalOrders,
      totalItemsSold: metrics.totalItemsSold,
      averageOrderValue: parseFloat(metrics.averageOrderValue.toFixed(2)),
      successRate: metrics.totalOrders > 0
        ? parseFloat(((metrics.successfulOrders / (metrics.successfulOrders + metrics.failedOrders)) * 100).toFixed(1))
        : 100,
      recoveryRate: metrics.failedOrders > 0
        ? parseFloat(((metrics.recoveredOrders / metrics.failedOrders) * 100).toFixed(1))
        : 100
    },
    breakdown: {
      revenueByCustomerTier: metrics.revenueByCustomerTier,
      revenueByProduct: metrics.revenueByProduct,
      ordersByHour: metrics.ordersByHour
    },
    reliability: {
      successfulOrders: metrics.successfulOrders,
      failedOrders: metrics.failedOrders,
      recoveredOrders: metrics.recoveredOrders
    }
  });
});

// GET recent events
router.get("/events", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const recentEvents = events.slice(-limit).reverse();

  return success(res, {
    total: events.length,
    showing: recentEvents.length,
    events: recentEvents
  });
});

// GET events for specific order
router.get("/events/:orderId", (req, res) => {
  const { orderId } = req.params;
  const orderEvents = events.filter(e => e.orderId === orderId);

  if (orderEvents.length === 0) {
    return error(res, `No events found for order ${orderId}`, 404, {
      type: "EVENTS_NOT_FOUND",
      orderId
    });
  }

  return success(res, {
    orderId,
    eventCount: orderEvents.length,
    events: orderEvents
  });
});

// POST config — failure simulation control
router.post("/config/failure-rate", (req, res) => {
  const { failureRate, timeoutRate, latencyMs, isOffline } = req.body;

  const updated = updateConfig("analytics", {
    ...(failureRate !== undefined && { failureRate }),
    ...(timeoutRate !== undefined && { timeoutRate }),
    ...(latencyMs !== undefined && { latencyMs }),
    ...(isOffline !== undefined && { isOffline })
  });

  logger.warn("ANALYTICS", "Failure configuration updated", { updated });

  return success(res, {
    message: "Analytics failure configuration updated",
    config: updated
  });
});

module.exports = router;