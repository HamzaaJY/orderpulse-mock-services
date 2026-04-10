const logger = {
  info: (service, message, meta = {}) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      service,
      message,
      ...meta
    }));
  },

  warn: (service, message, meta = {}) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "WARN",
      service,
      message,
      ...meta
    }));
  },

  error: (service, message, meta = {}) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      service,
      message,
      ...meta
    }));
  },

  request: (service, req, meta = {}) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "REQUEST",
      service,
      method: req.method,
      path: req.path,
      correlationId: req.headers["x-correlation-id"] || "none",
      ...meta
    }));
  }
};

module.exports = logger;