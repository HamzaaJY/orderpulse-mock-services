const { simulateFailure } = require("../../../../shared/failureSimulator");
const { error } = require("../../../../shared/responseHelper");
const logger = require("../../../../shared/logger");

const crmFailureSimulator = async (req, res, next) => {
  if (req.path.includes("/health") || req.path.includes("/config")) {
    return next();
  }

  try {
    await simulateFailure("crm");
    next();
  } catch (err) {
    logger.error("CRM", "Simulated failure triggered", {
      type: err.type,
      correlationId: req.headers["x-correlation-id"] || "none"
    });

    return error(res, err.message, err.code, {
      type: err.type,
      retryable: err.retryable,
      service: "CRM"
    });
  }
};

module.exports = crmFailureSimulator;