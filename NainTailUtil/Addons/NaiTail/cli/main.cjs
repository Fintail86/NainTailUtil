"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NainTailApplication } = require("../app/core/application.cjs");
const { asPublicError, NainTailError } = require("../app/core/errors.cjs");
const { defaultProductRoot } = require("../app/core/paths.cjs");
const { materializeProject } = require("../app/core/request-resolver.cjs");

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else flags[key] = true;
  }
  return { positional, flags };
}

function print(value, jsonl = false) {
  process.stdout.write(`${JSON.stringify(value, null, jsonl ? 0 : 2)}\n`);
}

function readConfig(filePath) {
  if (!filePath) throw new NainTailError("CONFIG_REQUIRED", "--config JSON 파일이 필요합니다.");
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

async function run(options = {}) {
  const { positional, flags } = parseArgs(options.argv || process.argv.slice(2));
  const [group = "help", action] = positional;
  const jsonl = Boolean(flags.jsonl);
  const app = new NainTailApplication({
    productRoot: options.dataRoot || options.productRoot || defaultProductRoot(),
    outputRoot: options.outputRoot,
  });
  if (jsonl) {
    app.on("queue", (event) => print({ event: "queue", data: event }, true));
    app.on("result", (result) => print({ event: "result", data: result }, true));
  }

  try {
    if (group === "status") {
      print({ ok: true, result: await app.liveStatus() }, jsonl);
      return;
    }

    if (group === "projects" && action === "list") {
      print({ ok: true, result: app.listProjects() }, jsonl);
      return;
    }
    if (group === "projects" && action === "create") {
      print({ ok: true, result: app.createProject({ name: flags.name || "새 작품" }) }, jsonl);
      return;
    }
    if (group === "projects" && action === "get") {
      print({ ok: true, result: app.getProject(flags.id) }, jsonl);
      return;
    }
    if (group === "projects" && action === "save") {
      print({ ok: true, result: app.saveProject(readConfig(flags.config)) }, jsonl);
      return;
    }

    if (group === "presets" && action === "list") {
      print({ ok: true, result: app.listPresets().filter((preset) => !flags.type || preset.type === flags.type).map(({ id, fileName, ...preset }) => preset) }, jsonl);
      return;
    }
    if (group === "presets" && action === "get") {
      print({ ok: true, result: app.getPreset(flags.name ? { type: flags.type, name: flags.name } : flags.id) }, jsonl);
      return;
    }
    if (group === "presets" && action === "save") {
      print({ ok: true, result: app.savePreset(readConfig(flags.config)) }, jsonl);
      return;
    }
    if (group === "presets" && action === "delete") {
      print({ ok: true, result: app.deletePreset(flags.name ? { type: flags.type, name: flags.name } : flags.id) }, jsonl);
      return;
    }

    if (group === "artist-study" && action === "get") {
      print({ ok: true, result: app.getArtistStudy() }, jsonl);
      return;
    }
    if (group === "artist-study" && action === "save") {
      print({ ok: true, result: app.saveArtistStudy(readConfig(flags.config)) }, jsonl);
      return;
    }
    if (group === "artist-study" && action === "randomize") {
      print({ ok: true, result: app.randomizeArtistStudy(readConfig(flags.config)) }, jsonl);
      return;
    }

    if (group === "plan" && action === "project") {
      const project = app.getProject(flags.id);
      const tasks = materializeProject(project, {
        scope: flags.scope || "all",
        characterId: flags.character,
      });
      print({ ok: true, result: { count: tasks.length, tasks } }, jsonl);
      return;
    }

    if (group === "generate" && action === "single") {
      const queued = await app.enqueueSingle(readConfig(flags.config));
      const result = await app.waitForRun(queued.runId);
      print({ ok: result.status === "completed", result }, jsonl);
      if (result.status !== "completed") process.exitCode = 4;
      return;
    }
    if (group === "generate" && action === "artist-study") {
      const queued = await app.enqueueArtistStudy(readConfig(flags.config));
      const result = await app.waitForRun(queued.runId);
      print({ ok: result.status === "completed", result }, jsonl);
      if (result.status !== "completed") process.exitCode = 4;
      return;
    }
    if (group === "generate" && action === "project") {
      const queued = await app.enqueueProject(flags.id, {
        scope: flags.scope || "all",
        characterId: flags.character,
      });
      const result = await app.waitForRun(queued.runId);
      print({ ok: result.status === "completed", result }, jsonl);
      if (result.status !== "completed") process.exitCode = 4;
      return;
    }

    print({
      ok: true,
      usage: [
        "status [--jsonl]",
        "projects list|create|get|save",
        "presets list|get|save|delete",
        "presets get|delete --type example|character|sub-slot --name <name> (legacy --id supported)",
        "artist-study get|save|randomize --config <file>",
        "plan project --id <projectId> [--scope all|general|character]",
        "generate single --config <file> [--jsonl]",
        "generate artist-study --config <file> [--jsonl]",
        "generate project --id <projectId> [--scope ...] [--jsonl]",
      ],
    }, jsonl);
  } catch (error) {
    print({ ok: false, error: asPublicError(error) }, jsonl);
    process.exitCode = error.code === "NAI_TOKEN_MISSING" ? 3 : 4;
  } finally {
    app.close();
  }
}

if (require.main === module) run();

module.exports = { parseArgs, run };
