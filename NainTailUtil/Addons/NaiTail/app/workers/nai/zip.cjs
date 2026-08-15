"use strict";

const zlib = require("node:zlib");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("ZIP central directory를 찾을 수 없습니다.");
}

function extractFirstPng(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) throw new Error("ZIP 응답이 비어 있습니다.");
  const eocd = findEndOfCentralDirectory(zipBuffer);
  const entryCount = zipBuffer.readUInt16LE(eocd + 10);
  let offset = zipBuffer.readUInt32LE(eocd + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("ZIP central entry가 손상되었습니다.");
    const compression = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localOffset = zipBuffer.readUInt32LE(offset + 42);
    const fileName = zipBuffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (fileName.toLowerCase().endsWith(".png")) {
      if (zipBuffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error("ZIP local entry가 손상되었습니다.");
      const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
      const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);
      let output;
      if (compression === 0) output = Buffer.from(compressed);
      else if (compression === 8) output = zlib.inflateRawSync(compressed);
      else throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${compression}`);
      if (output.length !== uncompressedSize) throw new Error("ZIP 이미지 크기가 일치하지 않습니다.");
      return { fileName, data: output };
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error("NAI ZIP 응답에 PNG가 없습니다.");
}

module.exports = { extractFirstPng };

