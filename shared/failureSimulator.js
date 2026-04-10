// Default failure configuration per service
const failureConfigs = {
  erp: {
    failureRate: 0,        // 0-100 percentage
    timeoutRate: 0,        // 0-100 percentage
    latencyMs: 800,        // realistic ERP response time
    isOffline: false       // circuit breaker simulation
  },
  crm: {
    failureRate: 0,
    timeoutRate: 0,
    latencyMs: 400,
    isOffline: false
  },
  warehouse: {
    failureRate: 0,
    timeoutRate: 0,
    latencyMs: 300,
    isOffline: false
  },
  analytics: {
    failureRate: 0,
    timeoutRate: 0,
    latencyMs: 200,
    isOffline: false
  }
};

const simulateFailure = async (serviceName) => {
  const config = failureConfigs[serviceName];

  // Check if service is completely offline
  if (config.isOffline) {
    throw {
      type: "SERVICE_OFFLINE",
      code: 503,
      message: `${serviceName.toUpperCase()} system is currently offline`,
      retryable: true
    };
  }

  // Simulate realistic latency
  await new Promise(resolve => setTimeout(resolve, config.latencyMs));

  // Simulate timeout
  if (Math.random() * 100 < config.timeoutRate) {
    await new Promise(resolve => setTimeout(resolve, 30000)); // force timeout
    throw {
      type: "TIMEOUT",
      code: 504,
      message: `${serviceName.toUpperCase()} request timed out`,
      retryable: true
    };
  }

  // Simulate random failure
  if (Math.random() * 100 < config.failureRate) {
    throw {
      type: "INTERNAL_ERROR",
      code: 500,
      message: `${serviceName.toUpperCase()} internal processing error`,
      retryable: true
    };
  }
};

const updateConfig = (serviceName, updates) => {
  if (!failureConfigs[serviceName]) {
    throw new Error(`Unknown service: ${serviceName}`);
  }
  failureConfigs[serviceName] = {
    ...failureConfigs[serviceName],
    ...updates
  };
  return failureConfigs[serviceName];
};

const getConfig = (serviceName) => {
  return failureConfigs[serviceName] || null;
};

const getAllConfigs = () => {
  return failureConfigs;
};

module.exports = {
  simulateFailure,
  updateConfig,
  getConfig,
  getAllConfigs
};