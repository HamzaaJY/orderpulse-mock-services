
/**
 * userMiddleware.js
 * ─────────────────────────────────────────────────────────────────
 * Drop this into every mock service.
 * Extracts x-user-id header, validates it, attaches to req.userId.
 * If missing or malformed → returns 400.
 *
 * Usage in any Express service:
 *   const { userMiddleware } = require("./middleware/userMiddleware");
 *   app.use(userMiddleware);
 */
 
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const ANONYMOUS_ID = "anonymous";
 
/**
 * Extracts userId from:
 *   1. x-user-id header (primary)
 *   2. Query param ?userId= (fallback for GET requests)
 *
 * Attaches to req.userId for downstream handlers.
 * Allows anonymous access with ANONYMOUS_ID fallback so health
 * checks and internal calls don't break.
 */
const userMiddleware = (req, res, next) => {
  const rawId =
    req.headers["x-user-id"] ||
    req.query.userId ||
    null;
 
  // Health checks and internal service calls skip user scoping
  if (req.path === "/health" || req.path === "/api/health") {
    req.userId = ANONYMOUS_ID;
    return next();
  }
 
  // Config endpoints (POST /api/*/config/failure-rate) are user-scoped
  // but also accept anonymous for backward compatibility during dev
  if (!rawId) {
    req.userId = ANONYMOUS_ID;
    return next();
  }
 
  if (!USER_ID_PATTERN.test(rawId)) {
    return res.status(400).json({
      success: false,
      error: {
        type: "INVALID_USER_ID",
        message: "x-user-id header must be 8-64 alphanumeric characters",
        code: 400,
      },
    });
  }
 
  req.userId = rawId;
  next();
};
 
module.exports = { userMiddleware, ANONYMOUS_ID };