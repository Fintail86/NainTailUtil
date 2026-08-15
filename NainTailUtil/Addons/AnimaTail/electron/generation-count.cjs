"use strict";

const { selectedSubPromptEntries } = require("./sub-prompt-selection.cjs");

function positiveInteger(value, fallback = 1) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function generationVariantCount(request) {
  if (Array.isArray(request?.variants) && request.variants.length > 0) {
    return request.variants.length;
  }
  return Math.max(1, selectedSubPromptEntries(request?.subPrompts).length);
}

function generationJobCount(request) {
  return positiveInteger(request?.queueCount) * generationVariantCount(request);
}

function expectedGenerationImageCount(request) {
  return positiveInteger(request?.batchSize) * generationJobCount(request);
}

module.exports = {
  expectedGenerationImageCount,
  generationJobCount,
  generationVariantCount,
};
