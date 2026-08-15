"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_CHUNK_TYPES = new Set(["tEXt", "zTXt", "iTXt"]);
const MAX_TEXT_CHUNK_BYTES = 4 * 1024 * 1024;

function readBuffer(fileDescriptor, length, position) {
  const buffer = Buffer.allocUnsafe(length);
  return fs.readSync(fileDescriptor, buffer, 0, length, position) === length ? buffer : null;
}

function nullIndex(buffer, start = 0) {
  const index = buffer.indexOf(0, start);
  return index >= start ? index : -1;
}

function decodeTextChunk(type, data) {
  const keywordEnd = nullIndex(data);
  if (keywordEnd <= 0) return null;
  const keyword = data.subarray(0, keywordEnd).toString("latin1");

  try {
    if (type === "tEXt") {
      return { keyword, value: data.subarray(keywordEnd + 1).toString("latin1") };
    }

    if (type === "zTXt") {
      const methodIndex = keywordEnd + 1;
      if (data[methodIndex] !== 0) return null;
      return {
        keyword,
        value: zlib.inflateSync(data.subarray(methodIndex + 1)).toString("latin1"),
      };
    }

    let cursor = keywordEnd + 1;
    const compressionFlag = data[cursor];
    const compressionMethod = data[cursor + 1];
    cursor += 2;
    const languageEnd = nullIndex(data, cursor);
    if (languageEnd < 0) return null;
    cursor = languageEnd + 1;
    const translatedKeywordEnd = nullIndex(data, cursor);
    if (translatedKeywordEnd < 0) return null;
    cursor = translatedKeywordEnd + 1;
    let text = data.subarray(cursor);
    if (compressionFlag === 1) {
      if (compressionMethod !== 0) return null;
      text = zlib.inflateSync(text);
    } else if (compressionFlag !== 0) {
      return null;
    }
    return { keyword, value: text.toString("utf8") };
  } catch {
    return null;
  }
}

function readPngText(filePath, keyword) {
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(filePath, "r");
    const fileSize = fs.fstatSync(fileDescriptor).size;
    const signature = readBuffer(fileDescriptor, PNG_SIGNATURE.length, 0);
    if (!signature?.equals(PNG_SIGNATURE)) return null;

    let position = PNG_SIGNATURE.length;
    while (position + 12 <= fileSize) {
      const header = readBuffer(fileDescriptor, 8, position);
      if (!header) return null;
      const length = header.readUInt32BE(0);
      const type = header.subarray(4, 8).toString("ascii");
      const dataPosition = position + 8;
      const nextPosition = dataPosition + length + 4;
      if (nextPosition > fileSize) return null;

      if (TEXT_CHUNK_TYPES.has(type) && length <= MAX_TEXT_CHUNK_BYTES) {
        const data = readBuffer(fileDescriptor, length, dataPosition);
        const decoded = data ? decodeTextChunk(type, data) : null;
        if (decoded?.keyword === keyword) return decoded.value;
      }

      position = nextPosition;
      if (type === "IEND") break;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
  }
}

function readAnimaMetadata(filePath) {
  const raw = readPngText(filePath, "AnimaUtil");
  if (!raw) return null;
  try {
    const metadata = JSON.parse(raw);
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

module.exports = { readAnimaMetadata, readPngText };
