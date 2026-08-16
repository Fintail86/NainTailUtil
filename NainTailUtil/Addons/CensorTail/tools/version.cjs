#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const addonRoot = path.resolve(__dirname, "..");
const nextVersion = String(process.argv[2] || "").trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  process.stderr.write("Usage: npm run version:set -- <semver>\n");
  process.exitCode = 1;
} else {
  for (const relativePath of ["addon.json", "package.json"]) {
    const filePath = path.join(addonRoot, relativePath);
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    document.version = nextVersion;
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(path.join(addonRoot, "VERSION"), `${nextVersion}\n`, "utf8");
  process.stdout.write(`CensorTail version set to ${nextVersion}.\n`);
}
