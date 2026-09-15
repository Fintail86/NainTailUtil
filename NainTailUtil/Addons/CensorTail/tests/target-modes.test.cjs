const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeOptions, sanitizeBox } = require("../electron/censor-service.cjs");
const { optionsSchema } = require("../mcp/tools.cjs");

const source = fs.readFileSync(path.join(__dirname, "../dist/renderer/assets/censortail-target-modes.js"), "utf8");
const renderer = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("target defaults apply between common and individual settings, excluding manual regions", async () => {
  const { resolveTargetOptions } = await renderer;
  const options = sanitizeOptions({ mode: "mosaic", color: "#123456", targetModes: { penis: "shape", nipple: "fog" } });
  assert.equal(resolveTargetOptions({ label: "penis" }, options).mode, "shape");
  assert.equal(resolveTargetOptions({ label: "nipple" }, options).mode, "fog");
  assert.equal(resolveTargetOptions({ label: "anus" }, options).mode, "mosaic");
  assert.equal(resolveTargetOptions({ label: "penis", manual: true }, options).mode, "mosaic");
  assert.equal(resolveTargetOptions({ label: "penis", effectOverride: { mode: "color" } }, options).mode, "color");
  assert.equal(resolveTargetOptions({ label: "penis" }, options).color, "#123456");
});

test("storage round-trip and backend validation agree on supported classes and modes", async () => {
  const { normalizeTargetModes, readTargetModes, writeTargetModes } = await renderer;
  const values = new Map();
  global.localStorage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  try {
    const input = { penis: "shape", nipple: "fog", anus: "", vagina: "invalid", "female face": "color" };
    const expected = { nipple: "fog", penis: "shape" };
    writeTargetModes(input);
    assert.deepEqual(readTargetModes(), expected);
    assert.deepEqual(normalizeTargetModes(input), sanitizeOptions({ targetModes: input }).targetModes);
    writeTargetModes({ penis: "" });
    assert.deepEqual(readTargetModes(), {});
    values.set("censortail.target-modes.v1", "invalid json");
    assert.deepEqual(readTargetModes(), {});
  } finally {
    delete global.localStorage;
  }
});

test("individual settings do not acquire global class defaults; MCP accepts targetModes", () => {
  const box = sanitizeBox({ classId: 2, x: 10, y: 10, width: 20, height: 20,
    effectOverride: { mode: "fog", targetModes: { penis: "shape" } } });
  assert.equal(box.effectOverride.mode, "fog");
  assert.equal(Object.hasOwn(box.effectOverride, "targetModes"), false);
  assert.deepEqual(optionsSchema.properties.targetModes.properties.penis.enum,
    ["mosaic", "color", "shape", "gradient", "fog"]);
});

test("fog initialization expands about the detector center without accumulating or changing manual regions", async () => {
  const { fitFogRegion } = await renderer;
  const original = { x: 100, y: 80, width: 200, height: 100 };
  const detection = { ...original, sourceBox: original, label: "penis" };
  const result = fitFogRegion(detection);
  assert.deepEqual({ x: result.x, y: result.y, width: result.width, height: result.height },
    { x: 75, y: 67.5, width: 250, height: 125 });
  assert.deepEqual(fitFogRegion(result), result);
  const legacy = fitFogRegion({ ...original });
  assert.deepEqual(fitFogRegion(legacy), legacy);
  const manual = { ...detection, manual: true };
  assert.equal(fitFogRegion(manual), manual);
});

test("each mode stores its own initial scale and fits from original coordinates", async () => {
  const { readBoxScales, writeBoxScales, fitInitialRegion, DEFAULT_BOX_SCALES } = await renderer;
  const values = new Map();
  global.localStorage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  try {
    assert.deepEqual(readBoxScales(), DEFAULT_BOX_SCALES);
    writeBoxScales({ mosaic: 1.4, fog: 1.8, shape: 1 });
    const scales = readBoxScales();
    assert.equal(scales.mosaic, 1.4);
    assert.equal(scales.fog, 1.8);
    const detection = { x: 50, y: 50, width: 100, height: 80,
      mask: { box: { x: 40, y: 40, width: 120, height: 100 } } };
    const mosaic = fitInitialRegion(detection, 'mosaic', scales);
    assert.equal(mosaic.width, 140);
    const fog = fitInitialRegion(mosaic, 'fog', scales);
    assert.equal(fog.width, 180);
    assert.deepEqual(fitInitialRegion(fog, 'fog', scales), fog);
    const shape = fitInitialRegion(fog, 'shape', scales);
    assert.equal(shape.x, 40);
    assert.equal(shape.width, 120);
    const color = fitInitialRegion(shape, 'color', scales);
    assert.equal(color.width, 100);
    writeBoxScales({ fog: 999, color: '', mosaic: null });
    assert.equal(readBoxScales().fog, 3);
    assert.equal(readBoxScales().color, 1);
    assert.equal(readBoxScales().mosaic, 1);
  } finally {
    delete global.localStorage;
  }
});

test("geometry edits snapshot effective settings only on an actual edit and respect explicit reset", async () => {
  const { applyRegionEdit, resolveTargetOptions } = await renderer;
  const detection = { label: 'penis', x: 20, y: 20, width: 100, height: 80 };
  const options = { mode: 'mosaic', targetModes: { penis: 'fog' }, fogDensity: 70, overwrite: false };
  const effective = resolveTargetOptions(detection, options);
  assert.equal(applyRegionEdit(detection, { width: 100 }, effective).effectOverride, undefined);
  assert.equal(applyRegionEdit(detection, { enabled: false }, effective).effectOverride, undefined);
  const changed = applyRegionEdit(detection, { width: 120 }, effective);
  assert.deepEqual(changed.effectOverride, { mode: 'fog', fogDensity: 70 });
  const resized = applyRegionEdit(changed, { height: 100 }, { ...options, fogDensity: 10 });
  assert.equal(resized.effectOverride.fogDensity, 70);
  assert.equal(applyRegionEdit(resized, { effectOverride: null, width: 100 }, effective).effectOverride, null);
});
