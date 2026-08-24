"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");
const { readJson, safeFileStem, writeJsonAtomic } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");

const ARTIST_FAVORITES_SCHEMA = "naitail.artist-favorites/v1";
const ARTIST_FAVORITES_SCHEMA_VERSION = 1;
const MAX_IMAGES_PER_ARTIST = 10;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function normalizedArtistKey(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function artistFolderStem(name) {
  const stem = safeFileStem(name, "artist");
  return WINDOWS_RESERVED_NAMES.test(stem) ? `_${stem}` : stem;
}

function resolveArtistDirectory(root, folder) {
  const folderName = String(folder || "").trim();
  if (!folderName || folderName !== path.basename(folderName)) {
    throw new NainTailError("INVALID_ARTIST_FAVORITES", "선호 작가 폴더 경로가 올바르지 않습니다.");
  }
  return resolveInside(root, folderName);
}

function assertPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NainTailError("INVALID_ARTIST_FAVORITES", "선호 이미지 경로가 작가 폴더를 벗어났습니다.");
  }
}

function emptyDatabase() {
  return {
    schema: ARTIST_FAVORITES_SCHEMA,
    schemaVersion: ARTIST_FAVORITES_SCHEMA_VERSION,
    updatedAt: null,
    artists: [],
  };
}

function validateDatabase(value) {
  if (!value || value.schema !== ARTIST_FAVORITES_SCHEMA || value.schemaVersion !== ARTIST_FAVORITES_SCHEMA_VERSION || !Array.isArray(value.artists)) {
    throw new NainTailError("INVALID_ARTIST_FAVORITES", "지원하지 않는 선호 작가 DB 형식입니다.");
  }
  return value;
}

class ArtistFavoriteStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.favoritesRoot = resolveInside(this.productRoot, "Favorites");
    this.root = resolveInside(this.favoritesRoot, "Searching");
    this.databasePath = resolveInside(this.root, "favorites.json");
    fs.mkdirSync(this.root, { recursive: true });
    this.migrateLegacyStore();
  }

  migrateLegacyStore() {
    const legacyDatabasePath = resolveInside(this.favoritesRoot, "favorites.json");
    if (!fs.existsSync(legacyDatabasePath) || fs.existsSync(this.databasePath)) return;
    const database = validateDatabase(readJson(legacyDatabasePath, "INVALID_ARTIST_FAVORITES"));
    for (const artist of database.artists) {
      const sourceDirectory = resolveInside(this.favoritesRoot, artist.folder);
      const targetDirectory = resolveInside(this.root, artist.folder);
      if (fs.existsSync(sourceDirectory) && !fs.existsSync(targetDirectory)) {
        fs.renameSync(sourceDirectory, targetDirectory);
      }
      artist.images = artist.images.map((image) => ({
        ...image,
        file: path.posix.join("Favorites", "Searching", artist.folder, path.posix.basename(String(image.file || "").replaceAll("\\", "/"))),
      }));
    }
    writeJsonAtomic(this.databasePath, database);
    fs.rmSync(legacyDatabasePath, { force: true });
  }

  get() {
    if (!fs.existsSync(this.databasePath)) return emptyDatabase();
    return validateDatabase(readJson(this.databasePath, "INVALID_ARTIST_FAVORITES"));
  }

  list() {
    return this.get().artists.map((artist) => ({
      key: artist.key,
      name: artist.name,
      imageCount: artist.images.length,
      preview: artist.images[0] ? {
        file: artist.images[0].file,
        seed: artist.images[0].seed,
        createdAt: artist.images[0].createdAt,
      } : null,
    }));
  }

  listDetails() {
    return this.get().artists.map((artist) => ({
      key: artist.key,
      name: artist.name,
      imageCount: artist.images.length,
      createdAt: artist.createdAt,
      updatedAt: artist.updatedAt,
      images: artist.images.map((image) => ({
        id: image.id,
        file: image.file,
        sha256: image.sha256,
        sourceResultId: image.sourceResultId,
        sourceRelativePath: image.sourceRelativePath,
        seed: image.seed,
        createdAt: image.createdAt,
      })),
    }));
  }

  removeImage(input = {}) {
    const artistKey = normalizedArtistKey(input.artistKey);
    const imageId = String(input.imageId || "");
    const database = this.get();
    const artistIndex = database.artists.findIndex((artist) => artist.key === artistKey);
    if (artistIndex < 0) throw new NainTailError("ARTIST_FAVORITE_NOT_FOUND", "삭제할 선호 작가를 찾을 수 없습니다.");
    const artist = database.artists[artistIndex];
    const imageIndex = artist.images.findIndex((image) => image.id === imageId);
    if (imageIndex < 0) throw new NainTailError("ARTIST_FAVORITE_IMAGE_NOT_FOUND", "삭제할 선호 이미지를 찾을 수 없습니다.");

    const [image] = artist.images.splice(imageIndex, 1);
    const artistDirectory = resolveArtistDirectory(this.root, artist.folder);
    const imagePath = resolveInside(this.productRoot, image.file);
    assertPathInside(artistDirectory, imagePath);
    const tombstonePath = resolveInside(artistDirectory, `.delete-${crypto.randomUUID()}.png`);
    const imageExists = fs.existsSync(imagePath);
    if (imageExists) fs.renameSync(imagePath, tombstonePath);
    const removedArtist = artist.images.length === 0;
    if (removedArtist) database.artists.splice(artistIndex, 1);
    else artist.updatedAt = new Date().toISOString();
    database.updatedAt = new Date().toISOString();

    try {
      writeJsonAtomic(this.databasePath, database);
    } catch (error) {
      if (imageExists && fs.existsSync(tombstonePath)) fs.renameSync(tombstonePath, imagePath);
      throw error;
    }
    if (imageExists) fs.rmSync(tombstonePath, { force: true });
    if (removedArtist) {
      try { fs.rmdirSync(artistDirectory); } catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error; }
    }
    return { artistKey: artist.key, artistName: artist.name, imageId: image.id, removedArtist, remainingImages: artist.images.length };
  }

  removeArtist(input = {}) {
    const artistKey = normalizedArtistKey(input.artistKey);
    const database = this.get();
    const artistIndex = database.artists.findIndex((artist) => artist.key === artistKey);
    if (artistIndex < 0) throw new NainTailError("ARTIST_FAVORITE_NOT_FOUND", "삭제할 선호 작가를 찾을 수 없습니다.");
    const [artist] = database.artists.splice(artistIndex, 1);
    const artistDirectory = resolveArtistDirectory(this.root, artist.folder);
    const tombstoneDirectory = resolveInside(this.root, `.delete-${crypto.randomUUID()}`);
    const directoryExists = fs.existsSync(artistDirectory);
    if (directoryExists) fs.renameSync(artistDirectory, tombstoneDirectory);
    database.updatedAt = new Date().toISOString();

    try {
      writeJsonAtomic(this.databasePath, database);
    } catch (error) {
      if (directoryExists && fs.existsSync(tombstoneDirectory)) fs.renameSync(tombstoneDirectory, artistDirectory);
      throw error;
    }
    if (directoryExists) fs.rmSync(tombstoneDirectory, { recursive: true, force: true });
    return { artistKey: artist.key, artistName: artist.name, removedImages: artist.images.length };
  }

  clear() {
    const database = this.get();
    const removedArtists = database.artists.length;
    const removedImages = database.artists.reduce((sum, artist) => sum + artist.images.length, 0);

    const tombstoneRoot = resolveInside(this.favoritesRoot, `.Searching-delete-${crypto.randomUUID()}`);
    fs.renameSync(this.root, tombstoneRoot);
    fs.mkdirSync(this.root, { recursive: true });
    const cleared = emptyDatabase();
    cleared.updatedAt = new Date().toISOString();
    try {
      writeJsonAtomic(this.databasePath, cleared);
    } catch (error) {
      fs.rmSync(this.root, { recursive: true, force: true });
      fs.renameSync(tombstoneRoot, this.root);
      throw error;
    }
    fs.rmSync(tombstoneRoot, { recursive: true, force: true });
    return { removedArtists, removedImages };
  }

  uniqueArtistFolder(database, artistKey, artistName) {
    const existing = database.artists.find((artist) => artist.key === artistKey);
    if (existing?.folder) return existing.folder;
    const desired = artistFolderStem(artistName);
    const desiredKey = desired.toLocaleLowerCase("en-US");
    const collision = desiredKey === path.basename(this.databasePath).toLocaleLowerCase("en-US")
      || database.artists.some((artist) => artist.key !== artistKey && artist.folder?.toLocaleLowerCase("en-US") === desiredKey);
    return collision ? `${desired}_${crypto.createHash("sha256").update(artistKey).digest("hex").slice(0, 8)}` : desired;
  }

  save(input = {}) {
    const artistName = String(input.artistName || "").normalize("NFKC").trim();
    const artistKey = normalizedArtistKey(artistName);
    if (!artistKey) throw new NainTailError("ARTIST_NAME_REQUIRED", "저장할 작가 이름이 없습니다.");

    const sourcePath = path.resolve(String(input.sourcePath || ""));
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new NainTailError("OUTPUT_NOT_FOUND", "선호 자료로 저장할 이미지 파일을 찾을 수 없습니다.");
    }
    const imageBytes = fs.readFileSync(sourcePath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!imageBytes.subarray(0, 8).equals(pngSignature)) {
      throw new NainTailError("INVALID_FAVORITE_IMAGE", "생성 결과 PNG만 선호 자료로 저장할 수 있습니다.");
    }
    const imageHash = crypto.createHash("sha256").update(imageBytes).digest("hex");
    const database = this.get();
    let artist = database.artists.find((item) => item.key === artistKey);
    const duplicate = artist?.images?.find((image) => image.sha256 === imageHash);
    if (duplicate) {
      return { artist: { name: artist.name, imageCount: artist.images.length }, image: duplicate, alreadySaved: true, maximum: MAX_IMAGES_PER_ARTIST };
    }
    if (artist && artist.images.length >= MAX_IMAGES_PER_ARTIST) {
      throw new NainTailError("ARTIST_FAVORITE_LIMIT", `${artist.name}의 선호 이미지는 최대 ${MAX_IMAGES_PER_ARTIST}장까지 저장할 수 있습니다.`);
    }

    const now = new Date().toISOString();
    const folder = this.uniqueArtistFolder(database, artistKey, artistName);
    const resultStem = safeFileStem(input.resultId, "favorite").slice(-36);
    const fileName = `${now.replace(/[-:.]/gu, "")}_${resultStem}_${imageHash.slice(0, 8)}.png`;
    const targetPath = resolveInside(this.root, folder, fileName);
    const relativePath = path.relative(this.productRoot, targetPath).replaceAll(path.sep, "/");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);

    const image = {
      id: String(input.resultId || imageHash),
      file: relativePath,
      sha256: imageHash,
      sourceResultId: String(input.resultId || "") || null,
      sourceRelativePath: String(input.sourceRelativePath || "").replaceAll("\\", "/") || null,
      seed: input.seed ?? null,
      createdAt: now,
    };
    if (!artist) {
      artist = { key: artistKey, name: artistName, folder, createdAt: now, updatedAt: now, images: [] };
      database.artists.push(artist);
    }
    artist.name = artistName;
    artist.updatedAt = now;
    artist.images.push(image);
    database.updatedAt = now;

    try {
      writeJsonAtomic(this.databasePath, database);
    } catch (error) {
      fs.rmSync(targetPath, { force: true });
      throw error;
    }
    return { artist: { name: artist.name, imageCount: artist.images.length }, image, alreadySaved: false, maximum: MAX_IMAGES_PER_ARTIST };
  }
}

module.exports = {
  ARTIST_FAVORITES_SCHEMA,
  ARTIST_FAVORITES_SCHEMA_VERSION,
  ArtistFavoriteStore,
  MAX_IMAGES_PER_ARTIST,
  artistFolderStem,
  normalizedArtistKey,
};
