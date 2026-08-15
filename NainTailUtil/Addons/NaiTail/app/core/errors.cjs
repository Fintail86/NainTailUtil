"use strict";

class NainTailError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "NainTailError";
    this.code = code;
    this.details = details;
  }
}

function asPublicError(error) {
  return {
    code: error?.code || "INTERNAL_ERROR",
    message: error?.message || "알 수 없는 오류가 발생했습니다.",
    details: error?.details || null,
  };
}

module.exports = { NainTailError, asPublicError };

