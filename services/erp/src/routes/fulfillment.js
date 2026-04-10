const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { success, error } = require("../../../../shared/responseHelper");
const logger = require("../../../../shared/logger");

// Mock fulfillment orders store
const fulfillmentOrders = new Map();

// Trigger fulfillment for an order
router.post("/trigger", (req, res) => {
  const { orderId, sku, quantity, customerId, shippingAddress } = req.body;

  if (!orderId || !sku || !quantity || !customerId) {
    return error(res, "Missing required fields", 400, {
      type: "VALIDATION_ERROR",
      required: ["orderId", "sku", "quantity", "customerId"]
    });
  }

  // Check if fulfillment already exists — idempotency
  if (fulfillmentOrders.has(orderId)) {
    const existing = fulfillmentOrders.get(orderId);
    logger.warn("ERP", "Duplicate fulfillment request — returning existing", {
      orderId,
      fulfillmentId: existing.fulfillmentId,
      correlationId: req.headers["x-correlation-id"]
    });
    return success(res, existing, 200);
  }

  const fulfillmentId = `FUL-${uuidv4().substring(0, 8).toUpperCase()}`;
  const estimatedShipDate = new Date();
  estimatedShipDate.setDate(estimatedShipDate.getDate() + 2);

  const fulfillmentRecord = {
    fulfillmentId,
    orderId,
    sku,
    quantity,
    customerId,
    shippingAddress: shippingAddress || "On file",
    status: "PROCESSING",
    priority: quantity > 5 ? "HIGH" : "STANDARD",
    estimatedShipDate: estimatedShipDate.toISOString(),
    createdAt: new Date().toISOString()
  };

  fulfillmentOrders.set(orderId, fulfillmentRecord);

  logger.info("ERP", "Fulfillment triggered successfully", {
    orderId,
    fulfillmentId,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, fulfillmentRecord, 201);
});

// Get fulfillment status
router.get("/status/:orderId", (req, res) => {
  const { orderId } = req.params;
  const fulfillment = fulfillmentOrders.get(orderId);

  if (!fulfillment) {
    return error(res, `No fulfillment found for order ${orderId}`, 404, {
      type: "FULFILLMENT_NOT_FOUND",
      orderId
    });
  }

  return success(res, fulfillment);
});

// Config endpoint — control failure simulation
router.post("/config/failure-rate", (req, res) => {
  const { updateConfig } = require("../../../../shared/failureSimulator");
  const { failureRate, timeoutRate, latencyMs, isOffline } = req.body;

  const updated = updateConfig("erp", {
    ...(failureRate !== undefined && { failureRate }),
    ...(timeoutRate !== undefined && { timeoutRate }),
    ...(latencyMs !== undefined && { latencyMs }),
    ...(isOffline !== undefined && { isOffline })
  });

  logger.warn("ERP", "Failure configuration updated", { updated });

  return success(res, {
    message: "ERP failure configuration updated",
    config: updated
  });
});

module.exports = router;