"use strict";

const { randomUUID } = require("node:crypto");

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

module.exports = { createId };

