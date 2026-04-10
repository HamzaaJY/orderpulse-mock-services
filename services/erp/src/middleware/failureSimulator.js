const { simulateFailure } = require("../../../../shared/failureSimulator");
const { error } = require("../../../../shared/responseHelper");
const logger = require("../../../../shared/logger");

const erpFailureSimulator = async (req, res, next) => {
  // Skip failure simulation for health and config endpoints
  if (req.path === "/health" || req.path.startsWith("/config")) {
    return next();
  }

  try {
    await simulateFailure("erp");
    next();
  } catch (err) {
    logger.error("ERP", "Simulated failure triggered", {
      type: err.type,
      correlationId: req.headers["x-correlation-id"] || "none"
    });

    return error(res, err.message, err.code, {
      type: err.type,
      retryable: err.retryable,
      service: "ERP"
    });
  }
};

module.exports = erpFailureSimulator;