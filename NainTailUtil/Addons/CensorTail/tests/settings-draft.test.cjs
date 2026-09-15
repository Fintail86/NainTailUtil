const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const moduleUrl = pathToFileURL(path.resolve(__dirname, '../dist/renderer/assets/censortail-settings-popup.js'));

test('draft edits across modes leave live values untouched until resolved', async () => {
  const { createSettingsDraft, editSettingsDraft, resolveSettingsDraft } = await import(moduleUrl);
  const options = { mode: 'fog', fogDensity: 70, mosaicSize: 12, overwrite: false };
  const scales = { fog: 1.25, mosaic: 1 };
  let draft = createSettingsDraft(options, scales, 'processed');
  draft = editSettingsDraft(draft, { fogDensity: 42, initialBoxScale: 1.8 });
  draft = editSettingsDraft(draft, { mode: 'mosaic' });
  draft = editSettingsDraft(draft, { mosaicSize: 31, initialBoxScale: 1.6, overwrite: true });
  assert.deepEqual(options, { mode: 'fog', fogDensity: 70, mosaicSize: 12, overwrite: false });
  assert.deepEqual(scales, { fog: 1.25, mosaic: 1 });
  const confirmed = resolveSettingsDraft(draft, options, scales, 'processed');
  assert.deepEqual(confirmed.options, { mode: 'mosaic', fogDensity: 42, mosaicSize: 31, overwrite: true });
  assert.deepEqual(confirmed.boxScales, { fog: 1.8, mosaic: 1.6 });
  assert.equal(createSettingsDraft(options, scales, 'processed').options.fogDensity, 70);
});

test('confirmation preserves unrelated concurrent changes in the non-modal background', async () => {
  const { createSettingsDraft, editSettingsDraft, resolveSettingsDraft } = await import(moduleUrl);
  let draft = createSettingsDraft({ mode: 'fog', opacity: 1, targetModes: {} }, { fog: 1.25 }, 'processed');
  draft = editSettingsDraft(draft, { fogDensity: 42 });
  const live = { mode: 'shape', opacity: .8, targetModes: { nipple: 'color' } };
  let result = resolveSettingsDraft(draft, live, { fog: 1.25, color: 1.4 }, 'raw');
  assert.deepEqual(result.options, { ...live, fogDensity: 42 });
  assert.equal(result.boxScales.color, 1.4);
  assert.equal(result.maskPreview, 'raw');
  draft = { ...draft, maskPreview: 'processed', previewChanged: true };
  result = resolveSettingsDraft(draft, live, {}, 'raw');
  assert.equal(result.maskPreview, 'processed');
});
