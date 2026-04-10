const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { success, error } = require("../../../../shared/responseHelper");
const logger = require("../../../../shared/logger");

// Mock inventory database
const inventory = {
  "SKU-LAPTOP-PRO": { name: "Professional Laptop", stock: 47, reserved: 3, unitPrice: 1299.99 },
  "SKU-MONITOR-4K": { name: "4K Monitor", stock: 23, reserved: 1, unitPrice: 449.99 },
  "SKU-KEYBOARD-MX": { name: "MX Mechanical Keyboard", stock: 89, reserved: 5, unitPrice: 129.99 },
  "SKU-HEADSET-PRO": { name: "Pro Headset", stock: 34, reserved: 2, unitPrice: 249.99 },
  "SKU-WEBCAM-HD": { name: "HD Webcam", stock: 61, reserved: 0, unitPrice: 89.99 }
};

// Check inventory for a SKU
router.get("/check/:sku", (req, res) => {
  const { sku } = req.params;
  const item = inventory[sku];

  if (!item) {
    return error(res, `SKU ${sku} not found in ERP system`, 404, {
      type: "SKU_NOT_FOUND",
      sku
    });
  }

  const available = item.stock - item.reserved;

  logger.info("ERP", "Inventory check completed", {
    sku,
    available,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, {
    sku,
    name: item.name,
    totalStock: item.stock,
    reserved: item.reserved,
    available,
    unitPrice: item.unitPrice,
    inStock: available > 0
  });
});

// Reserve inventory for an order
router.post("/reserve", (req, res) => {
  const { sku, quantity, orderId } = req.body;

  if (!sku || !quantity || !orderId) {
    return error(res, "Missing required fields: sku, quantity, orderId", 400, {
      type: "VALIDATION_ERROR",
      required: ["sku", "quantity", "orderId"]
    });
  }

  const item = inventory[sku];

  if (!item) {
    return error(res, `SKU ${sku} not found in ERP system`, 404, {
      type: "SKU_NOT_FOUND",
      sku
    });
  }

  const available = item.stock - item.reserved;

  if (available < quantity) {
    return error(res, `Insufficient stock for SKU ${sku}`, 409, {
      type: "INSUFFICIENT_STOCK",
      sku,
      requested: quantity,
      available
    });
  }

  // Reserve the inventory
  item.reserved += quantity;

  const reservationId = `RES-${uuidv4().substring(0, 8).toUpperCase()}`;

  logger.info("ERP", "Inventory reserved successfully", {
    orderId,
    sku,
    quantity,
    reservationId,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, {
    reservationId,
    orderId,
    sku,
    name: item.name,
    quantityReserved: quantity,
    unitPrice: item.unitPrice,
    totalValue: (item.unitPrice * quantity).toFixed(2),
    remainingStock: item.stock - item.reserved,
    status: "RESERVED"
  }, 201);
});

// Release inventory reservation (saga rollback)
router.post("/release", (req, res) => {
  const { sku, quantity, orderId, reservationId } = req.body;

  if (!sku || !quantity || !orderId) {
    return error(res, "Missing required fields: sku, quantity, orderId", 400, {
      type: "VALIDATION_ERROR"
    });
  }

  const item = inventory[sku];

  if (!item) {
    return error(res, `SKU ${sku} not found`, 404, {
      type: "SKU_NOT_FOUND"
    });
  }

  // Release the reservation
  item.reserved = Math.max(0, item.reserved - quantity);

  logger.warn("ERP", "Inventory reservation released — saga rollback", {
    orderId,
    sku,
    quantity,
    reservationId,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, {
    orderId,
    reservationId,
    sku,
    quantityReleased: quantity,
    status: "RELEASED",
    reason: "SAGA_ROLLBACK"
  });
});

module.exports = router;