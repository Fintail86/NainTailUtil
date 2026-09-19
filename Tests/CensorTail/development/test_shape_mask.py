"""Synthetic regression cases; private example images are not test fixtures."""
import base64
import io
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "NainTailUtil" / "Addons" / "CensorTail" / "app"))
from censor_worker import (apply_censor, decode_detection_mask, encode_instance_mask,
                           preview_image, retain_instance_components, save_image,
                           recover_shape_holes, refine_shape_mask, label_mask_components,
                           remove_soft_bridged_components)


class ShapeMaskTests(unittest.TestCase):
    def weak_contour_fixture(self):
        raw = Image.new('L', (160, 160))
        draw = ImageDraw.Draw(raw)
        draw.ellipse((20, 10, 80, 80), outline=60, width=3)
        draw.rectangle((30, 65, 70, 145), fill=255)
        # A weak attached spur and a detached weak ring are not missing interiors.
        draw.rectangle((69, 120, 95, 125), fill=60)
        draw.ellipse((110, 15, 150, 55), outline=60, width=3)
        return raw

    def test_recovers_weak_enclosed_tip_without_adding_detached_ring_or_spur(self):
        raw = self.weak_contour_fixture()
        core = refine_shape_mask(raw, .65, .05)
        result = recover_shape_holes(raw, core, .65)
        self.assertEqual(core.getpixel((50, 35)), 0)
        self.assertEqual(result.getpixel((50, 35)), 255)
        self.assertEqual(result.getpixel((130, 35)), 0)
        self.assertEqual(result.getpixel((90, 122)), 0)
        self.assertEqual(result.getpixel((5, 35)), 0)
        self.assertTrue(np.all(np.asarray(result) >= np.asarray(core)))

    def test_open_contour_does_not_invent_an_enclosure(self):
        raw = self.weak_contour_fixture()
        ImageDraw.Draw(raw).rectangle((35, 0, 65, 30), fill=0)
        core = refine_shape_mask(raw, .65, .05)
        self.assertEqual(recover_shape_holes(raw, core, .65).tobytes(), core.tobytes())

    def test_hole_free_masks_keep_original_threshold_and_soft_alpha(self):
        raw = Image.new('L', (100, 100))
        draw = ImageDraw.Draw(raw)
        draw.rectangle((10, 10, 90, 90), fill=60)
        draw.rectangle((30, 30, 70, 70), fill=166)
        core = refine_shape_mask(raw, .65, .05)
        self.assertEqual(recover_shape_holes(raw, core, .65).tobytes(), core.tobytes())
        empty = Image.new('L', raw.size)
        self.assertEqual(recover_shape_holes(raw, empty, .65).tobytes(), empty.tobytes())

    def test_all_edge_connected_background_regions_remain_exterior(self):
        raw = Image.new('L', (100, 100))
        ImageDraw.Draw(raw).rectangle((45, 0, 55, 99), fill=255)
        self.assertEqual(recover_shape_holes(raw, raw, .65).tobytes(), raw.tobytes())

    def test_rejects_weak_lateral_loop_attached_to_long_core(self):
        raw = Image.new('L', (180, 180))
        draw = ImageDraw.Draw(raw)
        draw.rectangle((65, 10, 95, 170), fill=255)
        # A nearby background outline touches the core, enclosing a false hole.
        draw.ellipse((90, 35, 165, 135), outline=60, width=4)
        core = refine_shape_mask(raw, .65, .05)
        result = recover_shape_holes(raw, core, .65)
        self.assertEqual(result.getpixel((135, 80)), 0)
        self.assertEqual(result.tobytes(), core.tobytes())
        # Rotating the same geometry must not turn that lateral loop into a tip.
        for angle in (35, 90):
            rotated = raw.rotate(angle, expand=True)
            rotated_core = refine_shape_mask(rotated, .65, .05)
            self.assertEqual(recover_shape_holes(rotated, rotated_core, .65).tobytes(),
                             rotated_core.tobytes())

    def test_round_core_does_not_justify_a_remote_missing_end(self):
        raw = Image.new('L', (160, 180))
        draw = ImageDraw.Draw(raw)
        draw.ellipse((60, 110, 100, 150), fill=255)
        draw.ellipse((60, 25, 100, 115), outline=60, width=3)
        core = refine_shape_mask(raw, .65, .05)
        self.assertEqual(recover_shape_holes(raw, core, .65).tobytes(), core.tobytes())

    def test_rotated_missing_tip_is_still_recovered(self):
        raw = self.weak_contour_fixture().rotate(35, expand=True)
        core = refine_shape_mask(raw, .65, .05)
        result = recover_shape_holes(raw, core, .65)
        self.assertGreater(np.count_nonzero(np.asarray(result)) - np.count_nonzero(np.asarray(core)), 1800)
        self.assertTrue(np.all(np.asarray(result) >= np.asarray(core)))

    def test_faint_in_box_specks_do_not_expand_into_blobs(self):
        values = np.zeros((150, 150), np.uint8)
        values[30:130, 50:110] = 255
        values[40:50, 20:30] = 10
        values[85:95, 20:30] = 255  # a substantive detached part still survives
        result = retain_instance_components(Image.fromarray(values), (10, 20, 130, 140))
        self.assertEqual(result.getpixel((25, 45)), 0)
        self.assertEqual(result.getpixel((25, 90)), 255)
        self.assertEqual(result.getpixel((80, 60)), 255)

    def test_soft_bridge_does_not_rescue_outside_background_core(self):
        values = np.zeros((200, 200), np.uint8)
        values[25:185, 75:135] = 60  # keep the original soft boundary
        values[30:180, 80:130] = 255
        values[80:120, 20:50] = 220
        for bridge_alpha in (60, 175):
            values[100, 49:81] = bridge_alpha
            mask = Image.fromarray(values)
            result = np.asarray(remove_soft_bridged_components(mask, (70, 20, 140, 190)))
            self.assertEqual(int(result[100, 35]), 0)
            self.assertEqual(int(result[100, 55]), 0)
            self.assertEqual(int(result[100, 72]), bridge_alpha)
            self.assertTrue(np.array_equal(result[25:185, 75:135], values[25:185, 75:135]))
            self.assertTrue(np.all(result <= values))

    def test_solid_narrow_extension_and_uncontested_soft_contour_survive(self):
        values = np.zeros((200, 200), np.uint8)
        values[30:180, 80:130] = 255
        values[80:120, 20:50] = 220
        values[100, 49:81] = 255
        values[29, 80:130] = 60
        mask = Image.fromarray(values)
        self.assertEqual(remove_soft_bridged_components(mask, (70, 20, 140, 190)).tobytes(), mask.tobytes())

    def test_soft_bridge_filter_runs_before_expansion(self):
        values = np.zeros((200, 200), np.uint8)
        values[30:180, 80:130] = 255
        values[80:120, 20:50] = 255
        values[100, 49:81] = 164  # becomes a faint alpha at the default threshold
        buffer = io.BytesIO(); Image.fromarray(values).save(buffer, format='PNG')
        detection = dict(x=0, y=0, width=200, height=200,
                         sourceBox=dict(x=70, y=20, width=70, height=170),
                         mask=dict(encoding='png-base64', box=dict(x=0, y=0, width=200, height=200),
                                   data=base64.b64encode(buffer.getvalue()).decode()))
        options = dict(mode='shape', color='#ffffff', expand=0, shapeExpand=5,
                       feather=0, spread=0, opacity=1, maskThreshold=.65, maskEdgeSoftness=.05)
        result = apply_censor(Image.new('RGB', (200, 200)), [detection], options)
        self.assertEqual(result.getpixel((35, 100)), (0, 0, 0))
        self.assertEqual(result.getpixel((100, 100)), (255, 255, 255))

    def test_component_connectivity_distinguishes_diagonal_exterior_escape(self):
        values = np.eye(3, dtype=np.uint8)
        diagonal = label_mask_components(values)
        cardinal = label_mask_components(values, diagonal=False)
        self.assertEqual(diagonal[0, 0], diagonal[1, 1])
        self.assertNotEqual(cardinal[0, 0], cardinal[1, 1])

    def test_rejects_background_with_only_a_small_overlap(self):
        values = np.zeros((100, 100), np.uint8)
        values[40:90, 20:70] = 255
        values[10:43, 80:99] = 200
        result = np.asarray(retain_instance_components(Image.fromarray(values), (20, 40, 100, 90)))
        self.assertTrue(np.array_equal(result[40:90, 20:70], values[40:90, 20:70]))
        self.assertEqual(int(result[10:43, 80:99].max()), 0)

    def test_preserves_extensions_beyond_detection_box(self):
        values = np.zeros((100, 100), np.uint8)
        values[30:80, 30:70] = 255
        values[10:40, 40:60] = 180
        result = retain_instance_components(Image.fromarray(values), (30, 30, 70, 80))
        self.assertEqual(result.tobytes(), values.tobytes())

    def test_preserves_disconnected_parts_inside_box(self):
        values = np.zeros((100, 100), np.uint8)
        values[30:80, 30:50] = 255
        values[30:50, 60:65] = 160
        result = retain_instance_components(Image.fromarray(values), (20, 20, 80, 90))
        self.assertEqual(result.tobytes(), values.tobytes())

    def test_diagonal_and_merging_runs_stay_connected(self):
        values = np.zeros((100, 100), np.uint8)
        values[50:80, 30:70] = 255
        values[10:50, 30:35] = 255
        values[10:50, 65:70] = 255
        values[9, 29] = 90
        result = retain_instance_components(Image.fromarray(values), (30, 50, 70, 80))
        self.assertEqual(result.tobytes(), values.tobytes())

    def test_no_overlap_does_not_erase_mask(self):
        values = np.zeros((30, 30), np.uint8)
        values[15:25, 15:25] = 255
        for box in [(0, 0, 5, 5), (40, 40, 50, 50)]:
            result = retain_instance_components(Image.fromarray(values), box)
            self.assertEqual(result.tobytes(), values.tobytes())

    def test_empty_mask(self):
        mask = Image.new('L', (30, 30))
        self.assertIsNone(retain_instance_components(mask, (0, 0, 30, 30)).getbbox())

    def test_logit_interpolation_preserves_subpixel_boundary(self):
        logits = np.full((320, 320), -1, dtype=np.float32)
        logits[:, 160:] = 9
        payload = encode_instance_mask(np.array([1], np.float32), logits[None],
                                       np.array([600, 600, 680, 680]), (1280, 1280), 1, 0, 0)
        mask = decode_detection_mask({'mask': payload})
        box = payload['box']
        self.assertLess(box['x'], 600)  # preserve requested expanded search region
        self.assertGreater(box['x'] + box['width'], 680)
        self.assertGreater(mask.getpixel((639 - int(box['x']), 640 - int(box['y']))), 230)

    def test_filter_runs_before_user_expansion_and_matches_preview_save(self):
        values = np.zeros((100, 100), np.uint8)
        values[40:90, 20:70] = 255
        values[10:43, 80:99] = 220
        buffer = io.BytesIO()
        Image.fromarray(values).save(buffer, format='PNG')
        detection = dict(x=-25, y=-25, width=150, height=150,
                         sourceBox=dict(x=20, y=40, width=80, height=50),
                         mask=dict(encoding='png-base64', width=100, height=100,
                                   box=dict(x=0, y=0, width=100, height=100),
                                   data=base64.b64encode(buffer.getvalue()).decode()))
        options = dict(mode='shape', color='#ffffff', expand=8, shapeExpand=3,
                       feather=0, spread=0, opacity=1, maskThreshold=.65,
                       maskEdgeSoftness=.05, overwrite=False)
        image = Image.new('RGB', (100, 100))
        result = apply_censor(image, [detection], options)
        self.assertEqual(result.getpixel((90, 25)), (0, 0, 0))
        self.assertEqual(result.getpixel((18, 60)), (255, 255, 255))  # expansion still works
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.png'
            image.save(source)
            preview = preview_image(source, [detection], options, 1600)
            preview_pixels = Image.open(io.BytesIO(base64.b64decode(preview['dataUrl'].split(',')[1])))
            saved = save_image(source, [detection], Path(directory) / 'output', options, {})
            with Image.open(saved['path']) as saved_image:
                self.assertEqual(result.tobytes(), saved_image.tobytes())
                self.assertEqual(result.tobytes(), preview_pixels.tobytes())

    def test_recovered_tip_survives_source_box_filter_and_preview_save(self):
        raw = self.weak_contour_fixture()
        buffer = io.BytesIO(); raw.save(buffer, format='PNG')
        detection = dict(x=0, y=0, width=160, height=160,
                         sourceBox=dict(x=30, y=65, width=40, height=80),
                         mask=dict(encoding='png-base64', box=dict(x=0, y=0, width=160, height=160),
                                   data=base64.b64encode(buffer.getvalue()).decode()))
        options = dict(mode='shape', color='#ffffff', expand=0, shapeExpand=0,
                       feather=0, spread=0, opacity=1, maskThreshold=.65,
                       maskEdgeSoftness=.05, overwrite=False)
        source_image = Image.new('RGB', raw.size)
        result = apply_censor(source_image, [detection], options)
        self.assertEqual(result.getpixel((50, 35)), (255, 255, 255))
        self.assertEqual(result.getpixel((130, 35)), (0, 0, 0))
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.png'; source_image.save(source)
            preview = preview_image(source, [detection], options, 1600)
            preview_pixels = Image.open(io.BytesIO(base64.b64decode(preview['dataUrl'].split(',')[1])))
            saved = save_image(source, [detection], Path(directory) / 'output', options, {})
            with Image.open(saved['path']) as saved_image:
                self.assertEqual(result.tobytes(), saved_image.tobytes())
                self.assertEqual(result.tobytes(), preview_pixels.tobytes())


if __name__ == '__main__':
    unittest.main()
