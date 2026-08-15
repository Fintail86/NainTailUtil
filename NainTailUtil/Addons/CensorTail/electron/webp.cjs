"use strict";

function uint24le(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function validDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function webpDimensions(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length < 20
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WEBP") return null;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const fourcc = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) return null;

    if (fourcc === "VP8X" && size >= 10) {
      return validDimensions(
        uint24le(buffer, dataOffset + 4) + 1,
        uint24le(buffer, dataOffset + 7) + 1,
      );
    }
    if (fourcc === "VP8 " && size >= 10
      && buffer[dataOffset + 3] === 0x9d
      && buffer[dataOffset + 4] === 0x01
      && buffer[dataOffset + 5] === 0x2a) {
      return validDimensions(
        buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      );
    }
    if (fourcc === "VP8L" && size >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return validDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }

    offset = dataOffset + size + (size % 2);
  }
  return null;
}

module.exports = { webpDimensions };
