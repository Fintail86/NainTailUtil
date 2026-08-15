"use strict";

const path = require("node:path");
const { AddonRegistry } = require("../host/addon-registry.cjs");

function selectAddon(registry, argv) {
  const forwarded = [...argv];
  const inline = forwarded.findIndex((value) => value.startsWith("--addon="));
  if (inline >= 0) {
    const [value] = forwarded.splice(inline, 1);
    return { addon: registry.get(value.slice("--addon=".length)), argv: forwarded, requested: value };
  }
  const index = forwarded.indexOf("--addon");
  if (index >= 0) {
    const id = forwarded[index + 1];
    forwarded.splice(index, 2);
    return { addon: registry.get(id), argv: forwarded, requested: id };
  }
  return { addon: registry.getDefault(), argv: forwarded, requested: null };
}

async function main() {
  const productRoot = path.resolve(__dirname, "..", "..");
  const registry = new AddonRegistry(productRoot);
  registry.discover();
  const selection = selectAddon(registry, process.argv.slice(2));
  const addon = selection.addon;
  if (selection.requested && !addon) throw new Error(`애드온을 찾을 수 없습니다: ${selection.requested}`);
  if (!addon) throw new Error("실행할 내장 애드온이 없습니다.");
  const entry = registry.load(addon, "cli");
  if (!entry || typeof entry.run !== "function") throw new Error(`CLI entry가 없습니다: ${addon.id}`);
  return entry.run({
    hostRoot: productRoot,
    productRoot: addon.directory,
    dataRoot: addon.directory,
    argv: selection.argv,
  });
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: "ADDON_START_FAILED", message: error.message } }, null, 2)}\n`);
    process.exitCode = 2;
  });
}

module.exports = { main, selectAddon };
