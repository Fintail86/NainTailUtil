"use strict";

const fs = require("node:fs");
const { normalizeArtistStudy, ARTIST_STUDY_SCHEMA } = require("./artist-study-model.cjs");
const { readJson, writeJsonAtomic } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");

class ArtistStudyStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.filePath = resolveInside(this.productRoot, "config", "artist-study.json");
  }

  get() {
    if (!fs.existsSync(this.filePath)) return normalizeArtistStudy();
    const study = readJson(this.filePath, "INVALID_ARTIST_STUDY");
    if (study.schema !== ARTIST_STUDY_SCHEMA) throw new Error("지원하지 않는 작례 연구기 schema입니다.");
    return normalizeArtistStudy(study);
  }

  save(input) {
    const study = normalizeArtistStudy(input);
    writeJsonAtomic(this.filePath, study);
    return study;
  }
}

module.exports = { ArtistStudyStore };
