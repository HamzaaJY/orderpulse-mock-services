const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { success, error } = require("../../../../shared/responseHelper");
const { updateConfig } = require("../../../../shared/failureSimulator");
const logger = require("../../../../shared/logger");

// Mock customer database
const customers = {
  "CUST-001": {
    id: "CUST-001",
    name: "Meridian Technologies Ltd",
    email: "procurement@meridiantech.com",
    phone: "+1-555-0101",
    tier: "ENTERPRISE",
    totalOrders: 47,
    totalSpend: 284750.00,
    creditLimit: 500000.00,
    paymentTerms: "NET-30",
    assignedRep: "Sarah Chen",
    tags: ["high-value", "enterprise", "priority-support"],
    address: {
      street: "1200 Innovation Drive",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "US"
    },
    preferences: {
      communicationChannel: "email",
      invoiceFormat: "PDF",
      shippingMethod: "EXPRESS"
    },
    createdAt: "2021-03-15T00:00:00.000Z"
  },
  "CUST-002": {
    id: "CUST-002",
    name: "Nexus Financial Group",
    email: "it@nexusfinancial.com",
    phone: "+1-555-0202",
    tier: "PREMIUM",
    totalOrders: 23,
    totalSpend: 98400.00,
    creditLimit: 200000.00,
    paymentTerms: "NET-15",
    assignedRep: "Marcus Williams",
    tags: ["financial-sector", "compliance-required"],
    address: {
      street: "500 Wall Street",
      city: "New York",
      state: "NY",
      zip: "10005",
      country: "US"
    },
    preferences: {
      communicationChannel: "email",
      invoiceFormat: "PDF",
      shippingMethod: "STANDARD"
    },
    createdAt: "2022-07-20T00:00:00.000Z"
  },
  "CUST-003": {
    id: "CUST-003",
    name: "Apex Healthcare Systems",
    email: "supply@apexhealthcare.com",
    phone: "+1-555-0303",
    tier: "ENTERPRISE",
    totalOrders: 89,
    totalSpend: 1250000.00,
    creditLimit: 2000000.00,
    paymentTerms: "NET-45",
    assignedRep: "Jennifer Park",
    tags: ["healthcare", "high-volume", "enterprise", "hipaa-compliant"],
    address: {
      street: "3400 Medical Center Blvd",
      city: "Houston",
      state: "TX",
      zip: "77030",
      country: "US"
    },
    preferences: {
      communicationChannel: "email",
      invoiceFormat: "EDI",
      shippingMethod: "EXPRESS"
    },
    createdAt: "2020-01-10T00:00:00.000Z"
  }
};

// Order history per customer
const orderHistory = new Map();

// GET customer by ID
router.get("/:customerId", (req, res) => {
  const { customerId } = req.params;
  const customer = customers[customerId];

  if (!customer) {
    return error(res, `Customer ${customerId} not found in CRM`, 404, {
      type: "CUSTOMER_NOT_FOUND",
      customerId
    });
  }

  logger.info("CRM", "Customer record retrieved", {
    customerId,
    tier: customer.tier,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, customer);
});

// POST update customer after order — progressive profiling
router.post("/:customerId/order-update", (req, res) => {
  const { customerId } = req.params;
  const { orderId, orderValue, sku } = req.body;

  if (!orderId || !orderValue) {
    return error(res, "Missing required fields: orderId, orderValue", 400, {
      type: "VALIDATION_ERROR"
    });
  }

  const customer = customers[customerId];

  if (!customer) {
    return error(res, `Customer ${customerId} not found`, 404, {
      type: "CUSTOMER_NOT_FOUND",
      customerId
    });
  }

  // Update customer stats
  customer.totalOrders += 1;
  customer.totalSpend += parseFloat(orderValue);

  // Log order in history
  if (!orderHistory.has(customerId)) {
    orderHistory.set(customerId, []);
  }

  const historyEntry = {
    orderId,
    orderValue: parseFloat(orderValue),
    sku,
    timestamp: new Date().toISOString()
  };

  orderHistory.get(customerId).push(historyEntry);

  logger.info("CRM", "Customer record updated after order", {
    customerId,
    orderId,
    newTotalOrders: customer.totalOrders,
    newTotalSpend: customer.totalSpend,
    correlationId: req.headers["x-correlation-id"]
  });

  return success(res, {
    customerId,
    orderId,
    updated: {
      totalOrders: customer.totalOrders,
      totalSpend: customer.totalSpend,
      lastOrderAt: new Date().toISOString()
    },
    journeyTriggered: customer.tier === "ENTERPRISE"
      ? "enterprise-post-purchase-sequence"
      : "standard-post-purchase-sequence",
    status: "UPDATED"
  });
});

// GET customer order history
router.get("/:customerId/history", (req, res) => {
  const { customerId } = req.params;
  const customer = customers[customerId];

  if (!customer) {
    return error(res, `Customer ${customerId} not found`, 404, {
      type: "CUSTOMER_NOT_FOUND"
    });
  }

  const history = orderHistory.get(customerId) || [];

  return success(res, {
    customerId,
    customerName: customer.name,
    totalOrders: customer.totalOrders,
    totalSpend: customer.totalSpend,
    recentOrders: history.slice(-10)
  });
});

// POST config — control failure simulation
router.post("/config/failure-rate", (req, res) => {
  const { failureRate, timeoutRate, latencyMs, isOffline } = req.body;

  const updated = updateConfig("crm", {
    ...(failureRate !== undefined && { failureRate }),
    ...(timeoutRate !== undefined && { timeoutRate }),
    ...(latencyMs !== undefined && { latencyMs }),
    ...(isOffline !== undefined && { isOffline })
  });

  logger.warn("CRM", "Failure configuration updated", { updated });

  return success(res, {
    message: "CRM failure configuration updated",
    config: updated
  });
});

module.exports = router;