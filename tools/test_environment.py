"""Validate render assets against the existing unit-box collision envelopes."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / 'assets/environment'

class EnvironmentTests(unittest.TestCase):
    def test_models_fit_colliders(self):
        for name in ('crate', 'container', 'tower'):
            with self.subTest(name=name):
                text = (ROOT / f'{name}.obj').read_text()
                vertices = [list(map(float, line.split()[1:])) for line in text.splitlines() if line.startswith('v ')]
                self.assertGreater(len(vertices), 24)
                for vertex in vertices:
                    self.assertTrue(all(-0.505 <= value <= 0.505 for value in vertex), vertex)
                self.assertIn('usemtl', text)
                self.assertTrue((ROOT / 'environment.mtl').exists())

    def test_streets_clear_spawn_plane(self):
        text = (ROOT / 'streets.obj').read_text()
        vertices = [list(map(float, line.split()[1:])) for line in text.splitlines() if line.startswith('v ')]
        self.assertGreater(len(vertices), 100)
        self.assertTrue(all(0 < v[1] <= 0.03 for v in vertices))
        self.assertTrue(all(abs(v[0]) <= 180 and abs(v[2]) <= 180 for v in vertices))

if __name__ == '__main__':
    unittest.main()
