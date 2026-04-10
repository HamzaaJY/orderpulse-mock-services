const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const logger = require("../../../shared/logger");
const requestLogger = require("./middleware/logger");
const warehouseFailureSimulator = require("./middleware/failureSimulator");
const notificationsRouter = require("./routes/notifications");
const healthRouter = require("./routes/health");

const app = express();
const PORT = process.env.PORT || 3003;
const SERVICE_NAME = "WAREHOUSE";

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-correlation-id",
    "x-source-system",
    "x-api-key"
  ]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use("/api", warehouseFailureSimulator);

app.use("/health", healthRouter);
app.use("/api/warehouse", notificationsRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 404,
      service: SERVICE_NAME
    }
  });
});

app.use((err, req, res, next) => {
  logger.error(SERVICE_NAME, "Unhandled error", {
    error: err.message,
    stack: err.stack,
    correlationId: req.headers["x-correlation-id"]
  });

  res.status(500).json({
    success: false,
    error: {
      message: "Internal server error",
      code: 500,
      service: SERVICE_NAME,
      correlationId: req.headers["x-correlation-id"] || null
    }
  });
});

app.listen(PORT, () => {
  logger.info(SERVICE_NAME, "OrderPulse Warehouse Service running", {
    port: PORT,
    environment: process.env.NODE_ENV || "development"
  });
});

module.exports = app;