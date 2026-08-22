"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");
const { NainTailError } = require("./errors.cjs");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_TYPES = new Set(["tEXt", "zTXt", "iTXt"]);
const GENERATION_METADATA_TYPES = new Set([...TEXT_TYPES, "eXIf"]);
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.allocUnsafe(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function createInternationalTextChunk(keyword, value) {
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(String(value), "utf8"),
  ]);
  return createChunk("iTXt", data);
}

function decodeTextChunk(type, data) {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd <= 0) return null;
  const keyword = data.subarray(0, keywordEnd).toString("latin1");
  try {
    if (type === "tEXt") return { keyword, value: data.subarray(keywordEnd + 1).toString("latin1") };
    if (type === "zTXt") {
      if (data[keywordEnd + 1] !== 0) return null;
      return { keyword, value: zlib.inflateSync(data.subarray(keywordEnd + 2)).toString("latin1") };
    }
    let cursor = keywordEnd + 1;
    const compressionFlag = data[cursor];
    const compressionMethod = data[cursor + 1];
    cursor += 2;
    const languageEnd = data.indexOf(0, cursor);
    if (languageEnd < 0) return null;
    cursor = languageEnd + 1;
    const translatedEnd = data.indexOf(0, cursor);
    if (translatedEnd < 0) return null;
    cursor = translatedEnd + 1;
    let text = data.subarray(cursor);
    if (compressionFlag === 1) {
      if (compressionMethod !== 0) return null;
      text = zlib.inflateSync(text);
    } else if (compressionFlag !== 0) return null;
    return { keyword, value: text.toString("utf8") };
  } catch {
    return null;
  }
}

function parseChunks(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new NainTailError("INVALID_PNG", "NAI 응답이 유효한 PNG가 아닙니다.");
  }
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (length > MAX_CHUNK_BYTES || end > pngBuffer.length) {
      throw new NainTailError("INVALID_PNG", "PNG chunk 경계가 잘못되었습니다.");
    }
    chunks.push({ type, data: pngBuffer.subarray(offset + 8, offset + 8 + length), raw: pngBuffer.subarray(offset, end) });
    offset = end;
    if (type === "IEND") break;
  }
  if (!chunks.some((chunk) => chunk.type === "IEND")) throw new NainTailError("INVALID_PNG", "PNG IEND chunk가 없습니다.");
  return chunks;
}

function withJsonMetadata(pngBuffer, keyword, metadata) {
  const chunks = parseChunks(pngBuffer);
  const output = [PNG_SIGNATURE];
  const replacement = createInternationalTextChunk(keyword, JSON.stringify(metadata));
  for (const chunk of chunks) {
    const decoded = TEXT_TYPES.has(chunk.type) ? decodeTextChunk(chunk.type, chunk.data) : null;
    if (decoded?.keyword === keyword) continue;
    if (chunk.type === "IEND") output.push(replacement);
    output.push(chunk.raw);
  }
  return Buffer.concat(output);
}

function withoutGenerationMetadata(pngBuffer) {
  const chunks = parseChunks(pngBuffer);
  return Buffer.concat([
    PNG_SIGNATURE,
    ...chunks.filter((chunk) => !GENERATION_METADATA_TYPES.has(chunk.type)).map((chunk) => chunk.raw),
  ]);
}

function readJsonMetadataFromBuffer(pngBuffer, keyword) {
  for (const chunk of parseChunks(pngBuffer)) {
    if (!TEXT_TYPES.has(chunk.type)) continue;
    const decoded = decodeTextChunk(chunk.type, chunk.data);
    if (decoded?.keyword !== keyword) continue;
    try {
      return JSON.parse(decoded.value);
    } catch {
      return null;
    }
  }
  return null;
}

function readJsonMetadata(filePath, keyword = "NainTailUtil") {
  return readJsonMetadataFromBuffer(fs.readFileSync(filePath), keyword);
}

module.exports = {
  PNG_SIGNATURE,
  createInternationalTextChunk,
  parseChunks,
  readJsonMetadata,
  readJsonMetadataFromBuffer,
  withJsonMetadata,
  withoutGenerationMetadata,
};
