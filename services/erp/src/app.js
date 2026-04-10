const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const logger = require("../../../shared/logger");
const requestLogger = require("./middleware/logger");
const erpFailureSimulator = require("./middleware/failureSimulator");

// Route imports
const healthRouter = require("./routes/health");
const inventoryRouter = require("./routes/inventory");
const fulfillmentRouter = require("./routes/fulfillment");

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = "ERP";

// Security middleware
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

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Failure simulation middleware
// Applied after health route so health checks always work
app.use("/api", erpFailureSimulator);

// Routes
app.use("/health", healthRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/fulfillment", fulfillmentRouter);

// 404 handler
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

// Global error handler
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

// Start server
app.listen(PORT, () => {
  logger.info(SERVICE_NAME, `OrderPulse ERP Service running`, {
    port: PORT,
    environment: process.env.NODE_ENV || "development"
  });
});

module.exports = app;