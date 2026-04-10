const success = (res, data, statusCode = 200, meta = {}) => {
  return res.status(statusCode).json({
    success: true,
    timestamp: new Date().toISOString(),
    correlationId: res.req.headers["x-correlation-id"] || null,
    data,
    ...meta
  });
};

const error = (res, message, statusCode = 500, details = {}) => {
  return res.status(statusCode).json({
    success: false,
    timestamp: new Date().toISOString(),
    correlationId: res.req.headers["x-correlation-id"] || null,
    error: {
      message,
      code: statusCode,
      ...details
    }
  });
};

const accepted = (res, data, meta = {}) => {
  return res.status(202).json({
    success: true,
    status: "ACCEPTED",
    timestamp: new Date().toISOString(),
    correlationId: res.req.headers["x-correlation-id"] || null,
    data,
    ...meta
  });
};

module.exports = { success, error, accepted };