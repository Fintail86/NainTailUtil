import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from censor_worker import apply_censor


class TargetModesTests(unittest.TestCase):
    def setUp(self):
        pixels = np.indices((48, 64)).sum(0) % 2 * 255
        self.image = Image.fromarray(pixels.astype(np.uint8)).convert('RGB')
        self.options = dict(mode='mosaic', color='#123456', expand=0, feather=0,
                            opacity=1, mosaicSize=8, targetModes={'penis': 'color'})
        self.detection = dict(label='penis', x=10, y=10, width=20, height=20)

    def assert_matches_mode(self, detection, mode):
        actual = apply_censor(self.image, [detection], self.options)
        expected = apply_censor(self.image, [{**detection, 'effectOverride': {'mode': mode}}],
                                {**self.options, 'targetModes': {}})
        self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_target_default(self):
        self.assert_matches_mode(self.detection, 'color')
        self.assertEqual(apply_censor(self.image, [self.detection], self.options).getpixel((15, 15)), (18, 52, 86))

    def test_unspecified_target_uses_common_mode(self):
        self.assert_matches_mode({**self.detection, 'label': 'nipple'}, 'mosaic')

    def test_manual_region_uses_common_mode(self):
        self.assert_matches_mode({**self.detection, 'manual': True}, 'mosaic')

    def test_individual_mode_wins(self):
        self.assert_matches_mode({**self.detection, 'effectOverride': {'mode': 'mosaic'}}, 'mosaic')


if __name__ == '__main__':
    unittest.main()
