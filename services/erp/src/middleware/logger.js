const logger = require("../../../../shared/logger");

const requestLogger = (req, res, next) => {
  logger.request("ERP", req, {
    correlationId: req.headers["x-correlation-id"] || "none",
    body: req.method !== "GET" ? req.body : undefined
  });
  next();
};

module.exports = requestLogger;