const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { success, error } = require("../../../../shared/responseHelper");
const { updateConfig } = require("../../../../shared/failureSimulator");
const logger = require("../../../../shared/logger");

// Mock warehouse zones
const warehouseZones = {
  "SKU-LAPTOP-PRO": { zone: "A", aisle: "A-12", bin: "B-04", picker: "WH-TEAM-A" },
  "SKU-MONITOR-4K": { zone: "B", aisle: "B-07", bin: "C-11", picker: "WH-TEAM-B" },
  "SKU-KEYBOARD-MX": { zone: "A", aisle: "A-03", bin: "A-22", picker: "WH-TEAM-A" },
  "SKU-HEADSET-PRO": { zone: "C", aisle: "C-15", bin: "D-08", picker: "WH-TEAM-C" },
  "SKU-WEBCAM-HD": { zone: "B", aisle: "B-02", bin: "B-17", picker: "WH-TEAM-B" }
};

// Pick tickets store
const pickTickets = new Map();

// Notify warehouse — create pick ticket
router.post("/notify", (req, res) => {
  const { orderId, sku, quantity, customerId, priority } = req.body;

  if (!orderId || !sku || !quantity) {
    return error(res, "Missing required fields: orderId, sku, quantity", 400, {
      type: "VALIDATION_ERROR",
      required: ["orderId", "sku", "quantity"]
    });
  }

  // Idempotency check
  if (pickTickets.has(orderId)) {
    const existing = pickTickets.get(orderId);
    logger.warn("WAREHOUSE", "Duplicate pick ticket request — returning existing", {
      orderId,
      ticketId: existing.ticketId,
      correlationId: req.headers["x-correlation-id"]
    });
    return success(res, existing, 200);
  }

  const location = warehouseZones[sku] || {
    zone: "D",
    aisle: "D-01",
    bin: "A-01",
    picker: "WH-TEAM-D"
  };

  const ticketId = `TKT-${uuidv4().substring(0, 8).toUpperCase()}`;
  const estimatedPickTime = new Date();
  estimatedPickTime.setMinutes(estimatedPickTime.getMinutes() + (priority === "HIGH" ? 15 : 45));

  const pickTicket = {
    ticketId,
    orderId,
    sku,
    quantity,
    customerId,
    priority: priority || "STANDARD",
    location,
    status: "PICK_PENDING",
    estimatedPickTime: estimatedPickTime.toISOString(),
    stages: [
      { stage: "PICK_PENDING", timestamp: new Date().toISOString(), completed: true },
      { stage: "PICKING", timestamp: null, completed: false },
      { stage: "PACKING", timestamp: null, completed: false },
      { stage: "READY_TO_SHIP", timestamp: null, completed: false },
      { stage: "SHIPPED", timestamp: null, completed: false }
    ],
    createdAt: new Date().toISOString()
  };

  pickTickets.set(orderId, pickTicket);

  logger.info("WAREHOUSE", "Pick ticket created", {
    orderId,
    ticketId,
    zone: location.zone,
    priority: pickTicket.priority,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, pickTicket, 201);
});

// GET pick ticket status
router.get("/status/:orderId", (req, res) => {
  const { orderId } = req.params;
  const ticket = pickTickets.get(orderId);

  if (!ticket) {
    return error(res, `No pick ticket found for order ${orderId}`, 404, {
      type: "TICKET_NOT_FOUND",
      orderId
    });
  }

  return success(res, ticket);
});

// PATCH advance pick ticket stage — simulate warehouse progress
router.patch("/advance/:orderId", (req, res) => {
  const { orderId } = req.params;
  const ticket = pickTickets.get(orderId);

  if (!ticket) {
    return error(res, `No pick ticket found for order ${orderId}`, 404, {
      type: "TICKET_NOT_FOUND"
    });
  }

  const stages = ["PICK_PENDING", "PICKING", "PACKING", "READY_TO_SHIP", "SHIPPED"];
  const currentIndex = stages.indexOf(ticket.status);

  if (currentIndex === stages.length - 1) {
    return error(res, "Order already shipped — cannot advance further", 400, {
      type: "ALREADY_COMPLETED"
    });
  }

  const nextStage = stages[currentIndex + 1];
  ticket.status = nextStage;
  ticket.stages[currentIndex + 1].timestamp = new Date().toISOString();
  ticket.stages[currentIndex + 1].completed = true;

  logger.info("WAREHOUSE", "Pick ticket stage advanced", {
    orderId,
    previousStage: stages[currentIndex],
    newStage: nextStage,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, ticket);
});

// POST config — failure simulation control
router.post("/config/failure-rate", (req, res) => {
  const { failureRate, timeoutRate, latencyMs, isOffline } = req.body;

  const updated = updateConfig("warehouse", {
    ...(failureRate !== undefined && { failureRate }),
    ...(timeoutRate !== undefined && { timeoutRate }),
    ...(latencyMs !== undefined && { latencyMs }),
    ...(isOffline !== undefined && { isOffline })
  });

  logger.warn("WAREHOUSE", "Failure configuration updated", { updated });

  return success(res, {
    message: "Warehouse failure configuration updated",
    config: updated
  });
});

module.exports = router;