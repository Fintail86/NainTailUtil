#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const packageInfo = require("../package.json");
const generationProfile = require("../electron/generation-profile.cjs");
const { GenerationApplication } = require("../electron/generation-application.cjs");
const { listModels } = require("../electron/model-catalog.cjs");
const { readRuntimeStatus } = require("../electron/runtime-status.cjs");
const {
  listPresets,
  readPreset,
  savePreset,
} = require("../electron/preset-service.cjs");
const {
  CliConfigError,
  readJsonFile,
  resolveGenerationConfig,
} = require("./generation-config.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const BOOLEAN_FLAGS = new Set(["json", "jsonl", "overwrite", "help"]);

let activeApplication = null;
let interrupted = false;

function parseArguments(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [name, inlineValue] = argument.slice(2).split(/=(.*)/su, 2);
    if (!name) throw new CliConfigError("ARGUMENT_INVALID", `잘못된 옵션입니다: ${argument}`);
    if (Object.hasOwn(flags, name)) {
      throw new CliConfigError("ARGUMENT_DUPLICATED", `같은 옵션을 여러 번 지정할 수 없습니다: --${name}`);
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined && !["true", "false"].includes(inlineValue)) {
        throw new CliConfigError("ARGUMENT_INVALID", `Boolean 옵션 형식이 잘못됐습니다: --${name}`);
      }
      flags[name] = inlineValue === undefined ? true : inlineValue === "true";
      continue;
    }
    const value = inlineValue === undefined ? argv[index + 1] : inlineValue;
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      throw new CliConfigError("ARGUMENT_VALUE_REQUIRED", `--${name} 값이 필요합니다.`);
    }
    flags[name] = value;
    if (inlineValue === undefined) index += 1;
  }
  if (flags.json && flags.jsonl) {
    throw new CliConfigError("OUTPUT_FORMAT_CONFLICT", "--json과 --jsonl은 함께 사용할 수 없습니다.");
  }
  return { positionals, flags };
}

function assertCommandShape(positionals, flags, expectedPositionals, allowedFlags) {
  if (positionals.length !== expectedPositionals) {
    throw new CliConfigError("COMMAND_ARGUMENT_INVALID", `명령 인자 수가 잘못됐습니다: ${positionals.join(" ")}`);
  }
  const globalFlags = new Set(["json", "jsonl", "help"]);
  const unknown = Object.keys(flags).filter((name) => !globalFlags.has(name) && !allowedFlags.has(name));
  if (unknown.length > 0) {
    throw new CliConfigError("OPTION_UNKNOWN", `지원하지 않는 옵션입니다: ${unknown.map((name) => `--${name}`).join(", ")}`);
  }
}

function publicCatalog(catalog) {
  return Object.fromEntries(Object.entries(catalog).map(([key, entries]) => [
    key,
    entries.map(({ absolutePath: _absolutePath, ...entry }) => entry),
  ]));
}

function envelope(event, requestId, data) {
  return {
    schemaVersion: 1,
    event,
    requestId: requestId || null,
    timestamp: new Date().toISOString(),
    data,
  };
}

function createReporter(flags, requestId = null) {
  const mode = flags.jsonl ? "jsonl" : flags.json ? "json" : "human";
  let currentRequestId = requestId;
  return {
    setRequestId(value) {
      currentRequestId = value;
    },
    event(event, data) {
      if (event === "log") {
        if (data?.message) process.stderr.write(`${data.message}\n`);
        return;
      }
      if (mode === "jsonl") {
        process.stdout.write(`${JSON.stringify(envelope(event, currentRequestId, data))}\n`);
      } else if (mode === "human" && ["loading", "progress"].includes(event)) {
        const progress = event === "progress"
          ? `image ${data.imageIndex || 0}/${data.totalImages || 0}, step ${data.step || 0}/${data.totalSteps || 0}`
          : data.phase || "loading";
        process.stderr.write(`[AnimaTail] ${progress}\n`);
      }
    },
    final(event, data) {
      const value = envelope(event, currentRequestId, data);
      process.stdout.write(`${mode === "jsonl" ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}`}\n`);
    },
  };
}

function helpText() {
  return `AnimaTail CLI ${packageInfo.version}

Usage:
  NainTailUtil_CLI.bat --addon animatail capabilities --json
  NainTailUtil_CLI.bat --addon animatail status --json
  NainTailUtil_CLI.bat --addon animatail models list --json
  NainTailUtil_CLI.bat --addon animatail presets list [--category <category>] --json
  NainTailUtil_CLI.bat --addon animatail presets get --category <category> --id <preset-id> --json
  NainTailUtil_CLI.bat --addon animatail presets save --config <preset.json> [--id <preset-id> --overwrite] --json
  NainTailUtil_CLI.bat --addon animatail generate single --config <job.json> [--json|--jsonl]
  NainTailUtil_CLI.bat --addon animatail generate multi --config <job.json> [--json|--jsonl]

Preset categories:
  base, prompts, negativePrompts, subPrompts, environments
`;
}

function capabilities() {
  return {
    cliSchemaVersion: 1,
    appVersion: packageInfo.version,
    commands: {
      status: { readOnly: true },
      models: { actions: ["list"], readOnly: true },
      presets: { actions: ["list", "get", "save"] },
      generate: { modes: ["single", "multi"], configSchemaVersion: 1 },
    },
    presetCategories: ["base", "prompts", "negativePrompts", "subPrompts", "environments"],
    sampling: {
      samplers: generationProfile.sampling.samplers,
      schedulers: generationProfile.sampling.schedulers,
      defaultSampler: generationProfile.sampling.defaultSampler,
      defaultScheduler: generationProfile.sampling.defaultScheduler,
    },
    limits: generationProfile.limits,
    output: {
      formats: ["json", "jsonl"],
      progressEvents: ["ready", "validated", "queued", "loading", "progress", "image", "completed", "cancelled", "error"],
    },
  };
}

function classifyError(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode;
  if (/찾을 수 없습니다|파일이 없습니다|준비되지 않았습니다/u.test(error?.message || "")) return 3;
  return 2;
}

function errorData(error) {
  return {
    code: error?.code || "CLI_ERROR",
    message: error?.message || String(error),
  };
}

function validateCategory(category) {
  if (!["base", "prompts", "negativePrompts", "subPrompts", "environments"].includes(category)) {
    throw new CliConfigError("PRESET_CATEGORY_INVALID", `지원하지 않는 프리셋 category입니다: ${category}`);
  }
  return category;
}

async function runReadCommand(positionals, flags, appRoot = APP_ROOT, options = {}) {
  const [command, action] = positionals;
  if (command === "capabilities") {
    assertCommandShape(positionals, flags, 1, new Set());
    return capabilities();
  }
  if (command === "status") {
    assertCommandShape(positionals, flags, 1, new Set());
    const runtime = readRuntimeStatus(appRoot, {
      runtimeRoot: options.runtimeRoot,
      runtimeManifestPath: options.runtimeManifestPath,
    });
    const catalog = listModels(appRoot);
    const presets = listPresets(appRoot);
    return {
      appRoot,
      appVersion: packageInfo.version,
      runtime,
      models: { models: catalog.models.length, loras: catalog.loras.length },
      presets: {
        base: presets.base.length,
        prompts: presets.prompts.length,
        negativePrompts: presets.negativePrompts.length,
        subPrompts: presets.subPrompts.length,
        environments: presets.environments.length,
        errors: presets.errors.length,
      },
      readyForGeneration: runtime.state === "ready" && runtime.supportAssetsReady && catalog.models.length > 0,
    };
  }
  if (command === "models" && action === "list") {
    assertCommandShape(positionals, flags, 2, new Set());
    return publicCatalog(listModels(appRoot));
  }
  if (command === "presets" && action === "list") {
    assertCommandShape(positionals, flags, 2, new Set(["category"]));
    const presets = listPresets(appRoot);
    if (!flags.category) return presets;
    const category = validateCategory(flags.category);
    return { category, items: presets[category], errors: presets.errors.filter((item) => item.category === category) };
  }
  if (command === "presets" && action === "get") {
    assertCommandShape(positionals, flags, 2, new Set(["category", "id"]));
    const category = validateCategory(flags.category);
    if (!flags.id) throw new CliConfigError("PRESET_ID_REQUIRED", "--id를 지정해 주세요.");
    try {
      return readPreset(appRoot, category, flags.id);
    } catch (error) {
      throw new CliConfigError("PRESET_NOT_FOUND", error.message, 3);
    }
  }
  if (command === "presets" && action === "save") {
    assertCommandShape(positionals, flags, 2, new Set(["config", "id", "overwrite"]));
    if (!flags.config) throw new CliConfigError("CONFIG_REQUIRED", "--config JSON 파일을 지정해 주세요.");
    const config = readJsonFile(path.resolve(flags.config || ""));
    const allowedConfigFields = new Set(["schemaVersion", "category", "name", "content", "items", "settings"]);
    const unknownConfigFields = Object.keys(config).filter((key) => !allowedConfigFields.has(key));
    if (unknownConfigFields.length > 0) {
      throw new CliConfigError(
        "UNKNOWN_PRESET_FIELD",
        `프리셋 설정에 지원하지 않는 필드가 있습니다: ${unknownConfigFields.join(", ")}`,
      );
    }
    if (config.schemaVersion !== undefined && config.schemaVersion !== 1) {
      throw new CliConfigError("SCHEMA_VERSION_UNSUPPORTED", `지원하지 않는 schemaVersion입니다: ${config.schemaVersion}`);
    }
    const category = validateCategory(config.category);
    let request = {
      category,
      name: config.name,
      content: config.content,
      items: config.items,
      settings: config.settings,
    };
    if (flags.id) {
      if (!flags.overwrite) {
        throw new CliConfigError("PRESET_OVERWRITE_REQUIRED", "기존 ID를 저장하려면 --overwrite를 함께 지정해 주세요.");
      }
      let previous;
      try {
        previous = readPreset(appRoot, category, flags.id);
      } catch (error) {
        throw new CliConfigError("PRESET_NOT_FOUND", error.message, 3);
      }
      request = { ...request, id: flags.id, name: request.name || previous.name };
    } else if (flags.overwrite) {
      throw new CliConfigError("PRESET_ID_REQUIRED", "--overwrite에는 --id가 필요합니다.");
    }
    return savePreset(appRoot, request);
  }
  return null;
}

async function runGeneration(mode, positionals, flags, reporter, requestId, appRoot = APP_ROOT, options = {}) {
  assertCommandShape(positionals, flags, 2, new Set(["config"]));
  if (!flags.config) throw new CliConfigError("CONFIG_REQUIRED", "--config JSON 파일을 지정해 주세요.");
  const rawConfig = readJsonFile(path.resolve(flags.config || ""));
  const resolved = resolveGenerationConfig(appRoot, rawConfig, mode);
  const effectiveRequestId = resolved.requestId || requestId;
  reporter.setRequestId(effectiveRequestId);
  reporter.event("ready", { mode, appVersion: packageInfo.version });
  activeApplication = new GenerationApplication({
    appRoot,
    runtimeRoot: options.runtimeRoot,
    runtimeManifestPath: options.runtimeManifestPath,
    outputRoot: options.outputRoot,
    appVersion: packageInfo.version,
    electronVersion: process.versions.electron || null,
    onEvent: ({ event, data }) => reporter.event(event, data),
  });
  try {
    const result = await activeApplication.run(resolved.request, effectiveRequestId);
    if (interrupted || result.status === "cancelled") {
      reporter.final("cancelled", result);
      return 130;
    }
    if (result.status === "partial") {
      reporter.final("error", { code: "PARTIAL_FAILURE", message: "일부 생성 작업이 실패했습니다.", ...result });
      return 5;
    }
    if (result.status === "failed") {
      reporter.final("error", { code: "GENERATION_FAILED", message: "이미지 생성에 실패했습니다.", ...result });
      return 4;
    }
    reporter.final("completed", result);
    return 0;
  } finally {
    await activeApplication.close();
    activeApplication = null;
  }
}

async function main(argv = process.argv.slice(2), appRoot = APP_ROOT, options = {}) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    const reporter = createReporter({ json: true });
    reporter.final("error", errorData(error));
    return classifyError(error);
  }
  const { positionals, flags } = parsed;
  if (flags.help || positionals.length === 0 || positionals[0] === "help") {
    process.stdout.write(helpText());
    return 0;
  }
  const requestId = randomUUID();
  const reporter = createReporter(flags, requestId);
  try {
    if (positionals[0] === "generate" && ["single", "multi"].includes(positionals[1])) {
      return await runGeneration(positionals[1], positionals, flags, reporter, requestId, appRoot, options);
    }
    const result = await runReadCommand(positionals, flags, appRoot, options);
    if (result === null) throw new CliConfigError("COMMAND_UNKNOWN", `지원하지 않는 명령입니다: ${positionals.join(" ")}`);
    reporter.final("completed", result);
    return 0;
  } catch (error) {
    reporter.final(interrupted ? "cancelled" : "error", errorData(error));
    return interrupted ? 130 : classifyError(error);
  }
}

process.on("SIGINT", () => {
  if (interrupted) {
    activeApplication?.executor?.shutdown?.();
    process.exit(130);
  }
  interrupted = true;
  activeApplication?.cancel();
});

process.on("SIGTERM", () => {
  interrupted = true;
  activeApplication?.cancel();
});

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = classifyError(error);
  });
}

async function run(options = {}) {
  const appRoot = path.resolve(options.productRoot || options.dataRoot || APP_ROOT);
  const exitCode = await main(options.argv || [], appRoot, {
    runtimeRoot: options.runtimeRoot || options.dependencies?.runtimeRoot,
    runtimeManifestPath: options.runtimeManifestPath || options.dependencies?.runtimeManifestPath,
    outputRoot: options.outputRoot,
  });
  if (exitCode) process.exitCode = exitCode;
  return exitCode;
}

module.exports = {
  APP_ROOT,
  capabilities,
  createReporter,
  main,
  parseArguments,
  run,
  runReadCommand,
};
