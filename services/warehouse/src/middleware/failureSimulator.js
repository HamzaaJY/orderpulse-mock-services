const { simulateFailure } = require("../../../../shared/failureSimulator");
const { error } = require("../../../../shared/responseHelper");
const logger = require("../../../../shared/logger");

const warehouseFailureSimulator = async (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/config")) {
    return next();
  }

  try {
    await simulateFailure("warehouse");
    next();
  } catch (err) {
    logger.error("WAREHOUSE", "Simulated failure triggered", {
      type: err.type,
      correlationId: req.headers["x-correlation-id"] || "none"
    });

    return error(res, err.message, err.code, {
      type: err.type,
      retryable: err.retryable,
      service: "WAREHOUSE"
    });
  }
};

module.exports = warehouseFailureSimulator;