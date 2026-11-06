import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('registry', Path(__file__).with_name('financial_registry.py'))
registry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry)

class CaptureTests(unittest.TestCase):
    def test_hashes_exact_body_and_excludes_other_origins_and_query(self):
        html = b'<script src="/app.js"></script><script>inline()</script><script src="https://cdn.example/a.js"></script><script src="/x.js?v=1"></script>'
        def fake(url, *args, **kwargs):
            if url == 'https://example.org/': return html, url, 'text/html'
            self.assertEqual(url, 'https://example.org/app.js')
            return b'abc', url, 'text/javascript'
        with patch.object(registry, 'fetch', side_effect=fake):
            result = registry.capture({'site':'example.org','candidateUrl':'https://example.org/'})
        self.assertEqual(result['scripts'][0]['hash'], 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
        self.assertEqual(result['inlineScriptsExcluded'], 1)
        self.assertEqual([s['status'] for s in result['scripts']], ['observed','excluded','excluded'])

    def test_blocked_site_stays_unavailable(self):
        with patch.object(registry, 'fetch', side_effect=ValueError('blocked')):
            result = registry.capture({'site':'example.org','candidateUrl':'https://example.org/'})
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['scripts'], [])

    def test_base_tag_cannot_make_cross_origin_asset_comparable(self):
        with patch.object(registry, 'fetch', return_value=(b'<base href="https://cdn.example/"><script src="app.js"></script>', 'https://example.org/', 'text/html')) as fetch:
            result = registry.capture({'site':'example.org','candidateUrl':'https://example.org/'})
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(result['status'], 'no-comparable-scripts')

    def test_private_destination_is_refused(self):
        with self.assertRaises(ValueError):
            registry.check_url('https://127.0.0.1/')

if __name__ == '__main__': unittest.main()
