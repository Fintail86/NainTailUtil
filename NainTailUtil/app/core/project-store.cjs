"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");
const { createProject, validateProject } = require("./project-model.cjs");
const { readJson, safeFileStem, writeJsonAtomic } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");

class ProjectStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.directory = resolveInside(this.productRoot, "Projects");
  }

  list() {
    return fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => {
        try {
          const project = validateProject(readJson(path.join(this.directory, entry.name), "INVALID_PROJECT"));
          return {
            id: project.id,
            name: project.name,
            updatedAt: project.updatedAt,
            fileName: entry.name,
            characterCount: project.characters.length,
            generalSlotCount: project.generalSlots.length,
          };
        } catch (error) {
          return { id: null, name: entry.name, fileName: entry.name, error: error.message };
        }
      })
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  findFileById(id) {
    return this.list().find((entry) => entry.id === id)?.fileName || null;
  }

  get(id) {
    const fileName = this.findFileById(id);
    if (!fileName) throw new NainTailError("PROJECT_NOT_FOUND", `작품을 찾을 수 없습니다: ${id}`);
    return validateProject(readJson(path.join(this.directory, fileName), "INVALID_PROJECT"));
  }

  save(input) {
    const project = validateProject(input?.id ? input : createProject(input));
    project.updatedAt = new Date().toISOString();
    const currentFile = this.findFileById(project.id);
    const fileName = `${safeFileStem(project.name, "project")}_${project.id.slice(-8)}.json`;
    const target = resolveInside(this.directory, fileName);
    writeJsonAtomic(target, project);
    if (currentFile && currentFile !== fileName) {
      fs.rmSync(resolveInside(this.directory, currentFile));
    }
    return project;
  }

  create(input = {}) {
    return this.save(createProject(input));
  }

  appendResult(projectId, result) {
    const project = this.get(projectId);
    // Persist only product-relative data. Absolute paths and file URLs are
    // session conveniences and would break when the product folder is moved.
    const { absolutePath: _absolutePath, outputUrl: _outputUrl, ...portableResult } = result;
    project.results.push(portableResult);
    return this.save(project);
  }

  removeResult(projectId, resultId) {
    const project = this.get(projectId);
    const before = project.results.length;
    project.results = project.results.filter((result) => result.id !== resultId);
    if (project.results.length === before) return project;
    return this.save(project);
  }
}

module.exports = { ProjectStore };
