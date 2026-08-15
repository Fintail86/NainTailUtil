from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np


APP_ROOT = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_ROOT))

from peropix_fog import render_peropix_fog  # noqa: E402


class PeroPixFogTests(unittest.TestCase):
    def render(self, *, seed: int = 12345, density: float = 70):
        return render_peropix_fog(
            (204, 136),
            (102, 68),
            (120, 80),
            feather=10,
            brightness=100,
            opacity=1,
            density=density,
            color=(255, 255, 255),
            seed=seed,
        )

    def test_same_box_produces_identical_texture(self):
        first_layer, first_mask = self.render()
        second_layer, second_mask = self.render()
        self.assertEqual(first_layer.tobytes(), second_layer.tobytes())
        self.assertEqual(first_mask.tobytes(), second_mask.tobytes())

    def test_box_seed_changes_noise_without_breaking_core(self):
        first_layer, first_mask = self.render(seed=12345)
        second_layer, second_mask = self.render(seed=54321)
        self.assertNotEqual(first_layer.tobytes(), second_layer.tobytes())
        self.assertNotEqual(first_mask.tobytes(), second_mask.tobytes())
        self.assertEqual(first_mask.getpixel((102, 68)), 255)
        self.assertEqual(second_mask.getpixel((102, 68)), 255)

    def test_texture_edges_are_transparent(self):
        _, mask = self.render()
        values = np.asarray(mask)
        self.assertEqual(int(values[0, :].max()), 0)
        self.assertEqual(int(values[-1, :].max()), 0)
        self.assertEqual(int(values[:, 0].max()), 0)
        self.assertEqual(int(values[:, -1].max()), 0)

    def test_density_keeps_pattern_and_increases_coverage(self):
        _, light_mask = self.render(density=0)
        _, dense_mask = self.render(density=100)
        light = np.asarray(light_mask, dtype=np.uint32)
        dense = np.asarray(dense_mask, dtype=np.uint32)
        self.assertGreater(int(dense.sum()), int(light.sum()))
        self.assertTrue(np.all(dense >= light))


if __name__ == "__main__":
    unittest.main()
