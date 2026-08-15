"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function huggingFaceUrl(repository, revision, sourcePath) {
  return `https://huggingface.co/${repository}/resolve/${revision}/${sourcePath}`;
}

function assetFile(repository, revision, sourcePath, relativePath, bytes, sha256) {
  return Object.freeze({
    sourcePath,
    relativePath,
    bytes,
    sha256,
    url: huggingFaceUrl(repository, revision, sourcePath),
  });
}

const ANIMA_REPOSITORY = "circlestone-labs/Anima";
const ANIMA_REVISION = "fa1c61a99d95dbede6beda996c69c739512df290";
const QWEN_REPOSITORY = "Qwen/Qwen3-0.6B";
const QWEN_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca";
const T5_REPOSITORY = "google/t5-v1_1-xxl";
const T5_REVISION = "3db67ab1af984cf10548a73467f0e5bca2aaaeb2";

const REQUIRED_SUPPORT_ASSETS = Object.freeze([
  Object.freeze({
    id: "text_encoder",
    name: "Qwen 3 0.6B Text Encoder",
    description: "Anima 프롬프트 인코딩에 필요한 고정 가중치",
    repository: ANIMA_REPOSITORY,
    revision: ANIMA_REVISION,
    license: "Circlestone Labs Non-Commercial License",
    relativePath: "text_encoders/qwen_3_06b_base.safetensors",
    files: Object.freeze([
      assetFile(
        ANIMA_REPOSITORY,
        ANIMA_REVISION,
        "split_files/text_encoders/qwen_3_06b_base.safetensors",
        "text_encoders/qwen_3_06b_base.safetensors",
        1192135096,
        "cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba",
      ),
    ]),
  }),
  Object.freeze({
    id: "vae",
    name: "Qwen-Image VAE",
    description: "Anima latent와 이미지 사이의 변환에 필요한 고정 가중치",
    repository: ANIMA_REPOSITORY,
    revision: ANIMA_REVISION,
    license: "Circlestone Labs Non-Commercial License",
    relativePath: "vae/qwen_image_vae.safetensors",
    files: Object.freeze([
      assetFile(
        ANIMA_REPOSITORY,
        ANIMA_REVISION,
        "split_files/vae/qwen_image_vae.safetensors",
        "vae/qwen_image_vae.safetensors",
        253806246,
        "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
      ),
    ]),
  }),
  Object.freeze({
    id: "qwen_tokenizer",
    name: "Qwen3 0.6B Tokenizer",
    description: "Qwen text encoder용 tokenizer 파일 묶음",
    repository: QWEN_REPOSITORY,
    revision: QWEN_REVISION,
    license: "Apache-2.0",
    relativePath: "tokenizers/qwen3_0.6b/",
    files: Object.freeze([
      assetFile(QWEN_REPOSITORY, QWEN_REVISION, "config.json", "tokenizers/qwen3_0.6b/config.json", 726, "660db3b73d788119c04535e48cf9be5f55bc3100841a718637ae695b442f27dd"),
      assetFile(QWEN_REPOSITORY, QWEN_REVISION, "merges.txt", "tokenizers/qwen3_0.6b/merges.txt", 1671853, "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5"),
      assetFile(QWEN_REPOSITORY, QWEN_REVISION, "tokenizer.json", "tokenizers/qwen3_0.6b/tokenizer.json", 11422654, "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4"),
      assetFile(QWEN_REPOSITORY, QWEN_REVISION, "tokenizer_config.json", "tokenizers/qwen3_0.6b/tokenizer_config.json", 9732, "d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101"),
      assetFile(QWEN_REPOSITORY, QWEN_REVISION, "vocab.json", "tokenizers/qwen3_0.6b/vocab.json", 2776833, "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"),
    ]),
  }),
  Object.freeze({
    id: "t5_tokenizer",
    name: "T5 v1.1 XXL Tokenizer",
    description: "Anima T5 tokenizer 입력에 필요한 공개 파일 묶음",
    repository: T5_REPOSITORY,
    revision: T5_REVISION,
    license: "Apache-2.0",
    relativePath: "tokenizers/t5_v1_1_xxl/",
    files: Object.freeze([
      assetFile(T5_REPOSITORY, T5_REVISION, "special_tokens_map.json", "tokenizers/t5_v1_1_xxl/special_tokens_map.json", 1786, "4720c0fddbe4c5991334f85ad7073d9bd0a294a8ba4641a2f8dab614ca825949"),
      assetFile(T5_REPOSITORY, T5_REVISION, "spiece.model", "tokenizers/t5_v1_1_xxl/spiece.model", 791656, "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86"),
      assetFile(T5_REPOSITORY, T5_REVISION, "tokenizer_config.json", "tokenizers/t5_v1_1_xxl/tokenizer_config.json", 1857, "b971dce1d2805c2a66da8657156e7114a30501c6ba602fc947c8bf607a3ead2d"),
      assetFile(T5_REPOSITORY, T5_REVISION, "config.json", "tokenizers/t5_v1_1_xxl/config.json", 593, "a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8"),
    ]),
  }),
]);

function totalBytes(asset) {
  return asset.files.reduce((sum, file) => sum + file.bytes, 0);
}

function targetPath(appRoot, file) {
  return path.join(appRoot, "Models", ...file.relativePath.split("/"));
}

function fileState(appRoot, file) {
  try {
    const stat = fs.statSync(targetPath(appRoot, file));
    return stat.isFile() && stat.size === file.bytes ? "ready" : "invalid";
  } catch {
    return "missing";
  }
}

function supportAssetState(appRoot, asset) {
  const states = asset.files.map((file) => fileState(appRoot, file));
  if (states.every((state) => state === "ready")) return "ready";
  return states.includes("invalid") ? "invalid" : "missing";
}

function requiredSupportAssetsReady(appRoot, assets = REQUIRED_SUPPORT_ASSETS) {
  return assets.every((asset) => supportAssetState(appRoot, asset) === "ready");
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyFile(appRoot, file) {
  const filePath = targetPath(appRoot, file);
  if (fileState(appRoot, file) !== "ready") return false;
  return await sha256(filePath) === file.sha256;
}

class SupportAssetService {
  constructor(appRoot, sendEvent = () => {}, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.sendEvent = sendEvent;
    this.fetch = options.fetch || globalThis.fetch;
    this.assets = options.assets || REQUIRED_SUPPORT_ASSETS;
    this.installing = new Map();
  }

  status() {
    return this.assets.map((asset) => {
      const status = supportAssetState(this.appRoot, asset);
      return {
        id: asset.id,
        name: asset.name,
        description: asset.description,
        repository: asset.repository,
        revision: asset.revision,
        license: asset.license,
        relativePath: asset.relativePath,
        bytes: totalBytes(asset),
        status,
        installed: status === "ready",
        installing: this.installing.has(asset.id),
      };
    });
  }

  install(assetId) {
    const asset = this.assets.find((item) => item.id === String(assetId));
    if (!asset) return Promise.reject(new Error("지원하지 않는 보조 자산입니다."));
    if (this.installing.has(asset.id)) return this.installing.get(asset.id);
    const promise = this.downloadAsset(asset).finally(() => this.installing.delete(asset.id));
    this.installing.set(asset.id, promise);
    return promise;
  }

  async downloadAsset(asset) {
    const expectedTotal = totalBytes(asset);
    let completedBytes = 0;
    this.sendEvent({ kind: "required", assetId: asset.id, event: "download", stage: "starting", progress: 0, total: expectedTotal });
    try {
      for (const file of asset.files) {
        if (await verifyFile(this.appRoot, file)) {
          completedBytes += file.bytes;
          continue;
        }
        await this.downloadFile(asset, file, completedBytes, expectedTotal);
        completedBytes += file.bytes;
      }
      this.sendEvent({ kind: "required", assetId: asset.id, event: "download", stage: "complete", progress: 100, total: expectedTotal });
      return this.status();
    } catch (error) {
      this.sendEvent({ kind: "required", assetId: asset.id, event: "download", stage: "error", message: error.message });
      throw error;
    }
  }

  async downloadFile(asset, file, completedBytes, expectedTotal) {
    const destination = targetPath(this.appRoot, file);
    const partPath = `${destination}.part`;
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rm(partPath, { force: true });
    try {
      const response = await this.fetch(file.url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`${asset.name} 다운로드 서버가 ${response.status} 상태를 반환했습니다.`);
      }
      const reader = response.body.getReader();
      const handle = await fs.promises.open(partPath, "w");
      const hash = createHash("sha256");
      let received = 0;
      let lastProgress = -1;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          received += chunk.length;
          hash.update(chunk);
          await handle.write(chunk);
          const totalReceived = completedBytes + received;
          const progress = Math.min(99, Math.round((totalReceived / expectedTotal) * 100));
          if (progress !== lastProgress) {
            lastProgress = progress;
            this.sendEvent({
              kind: "required",
              assetId: asset.id,
              event: "download",
              stage: "downloading",
              fileName: path.basename(destination),
              received: totalReceived,
              total: expectedTotal,
              progress,
            });
          }
        }
      } finally {
        await handle.close();
      }
      const digest = hash.digest("hex");
      if (received !== file.bytes || digest !== file.sha256) {
        throw new Error(`${asset.name} 파일의 크기 또는 SHA-256이 고정 manifest와 다릅니다.`);
      }
      await fs.promises.rm(destination, { force: true });
      await fs.promises.rename(partPath, destination);
    } catch (error) {
      await fs.promises.rm(partPath, { force: true });
      throw error;
    }
  }
}

module.exports = {
  REQUIRED_SUPPORT_ASSETS,
  SupportAssetService,
  requiredSupportAssetsReady,
  supportAssetState,
};
