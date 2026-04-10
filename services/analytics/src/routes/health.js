const express = require("express");
const router = express.Router();
const { success } = require("../../../../shared/responseHelper");
const { getConfig } = require("../../../../shared/failureSimulator");

router.get("/", (req, res) => {
  const config = getConfig("analytics");

  return success(res, {
    service: "OrderPulse Analytics Service",
    status: config.isOffline ? "OFFLINE" : "OPERATIONAL",
    version: "1.0.0",
    uptime: process.uptime(),
    config: {
      failureRate: `${config.failureRate}%`,
      timeoutRate: `${config.timeoutRate}%`,
      latencyMs: config.latencyMs,
      isOffline: config.isOffline
    }
  });
});

module.exports = router;