"use strict";

class CensorMcpError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CensorMcpError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.details = options.details || {};
  }
}

function publicError(error) {
  return {
    code: error?.code || "CENSOR_TOOL_ERROR",
    message: error?.message || String(error),
    retryable: error?.retryable === true,
    details: error?.details && typeof error.details === "object" ? error.details : {},
  };
}

module.exports = { CensorMcpError, publicError };
