"use strict";

const ARTIFACT_REF_SCHEMA = "naintail.artifact-ref/v1";
const ARTIFACT_SCOPES = new Set(["session"]);

function artifactError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function validateArtifactRef(reference) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw artifactError("ARTIFACT_REF_INVALID", "artifactRef가 객체가 아닙니다.");
  }
  const normalized = {
    schema: String(reference.schema || ""),
    addonId: String(reference.addonId || "").trim(),
    artifactId: String(reference.artifactId || "").trim(),
    kind: String(reference.kind || "").trim(),
    scope: String(reference.scope || "").trim(),
  };
  if (normalized.schema !== ARTIFACT_REF_SCHEMA
    || !normalized.addonId
    || !normalized.artifactId
    || !normalized.kind
    || !ARTIFACT_SCOPES.has(normalized.scope)) {
    throw artifactError("ARTIFACT_REF_INVALID", "artifactRef 필드가 올바르지 않습니다.", { reference: normalized });
  }
  return Object.freeze(normalized);
}

module.exports = {
  ARTIFACT_REF_SCHEMA,
  ARTIFACT_SCOPES,
  artifactError,
  validateArtifactRef,
};
