import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'tools' / 'verify_project.py'
spec = importlib.util.spec_from_file_location('verify_project', MODULE)
verify_project = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_project)


class PublicChecksTest(unittest.TestCase):
    def test_private_paths_and_broken_readme_links_are_reported_without_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'README.md').write_text('See [guide](docs/missing.md).\n', encoding='utf-8')
            (root / 'firmware').mkdir()
            (root / 'firmware' / 'demo.yaml').write_text('path: /Users/example/private\n', encoding='utf-8')
            (root / 'firmware' / 'secrets.yaml').write_text('password: should-not-be-read\n', encoding='utf-8')
            issues = verify_project.public_issues(root)
            self.assertEqual(len(issues), 2)
            self.assertTrue(any('broken link' in issue for issue in issues))
            self.assertTrue(any('private path' in issue for issue in issues))
            self.assertNotIn('example/private', '\n'.join(issues))
            self.assertNotIn('should-not-be-read', '\n'.join(issues))

    def test_all_public_markdown_links_and_images_are_checked(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for directory in ('docs', 'design', 'firmware', '.github'):
                (root / directory).mkdir()
            (root / 'guide.md').write_text('[broken](missing.md) ![broken](missing.png)', encoding='utf-8')
            for directory in ('docs', 'design', 'firmware', '.github'):
                (root / directory / 'guide.md').write_text(
                    '[missing](missing.md) ![missing](missing.png) '
                    '[external](https://example.com/nope) [anchor](#section) '
                    '[mail](mailto:test@example.com)', encoding='utf-8')
            issues = verify_project.public_issues(root)
            self.assertEqual(sum('broken link' in issue for issue in issues), 10)
            for directory in ('docs', 'design', 'firmware', '.github'):
                self.assertEqual(sum(issue.startswith(directory + '/guide.md:') for issue in issues), 2)

    def test_ignored_directories_and_secret_files_are_not_read(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'docs').mkdir()
            for directory in ('local', 'output', 'artifacts', '.pio', '.venv'):
                path = root / 'docs' / directory
                path.mkdir()
                (path / 'private.md').write_text('path /Users/private/location [broken](private)', encoding='utf-8')
            (root / 'docs' / 'secrets-private.md').write_text('/Users/secret/location', encoding='utf-8')
            self.assertEqual(verify_project.public_issues(root), [])

    def test_literal_password_is_reported_without_leaking_value(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'firmware').mkdir()
            (root / 'firmware' / 'demo.yaml').write_text('password: forbidden-value\n', encoding='utf-8')
            issues = verify_project.public_issues(root)
            self.assertEqual(len(issues), 1)
            self.assertIn('literal credential', issues[0])
            self.assertNotIn('forbidden-value', issues[0])

    def test_private_ip_in_docs_but_not_documentation_example_is_flagged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'docs').mkdir()
            (root / 'docs' / 'guide.md').write_text('192.0.2.10\n192.168.2.42\n', encoding='utf-8')
            issues = verify_project.public_issues(root)
            self.assertEqual(len(issues), 1)
            self.assertIn('private IP', issues[0])
            self.assertNotIn('192.168.2.42', issues[0])


if __name__ == '__main__':
    unittest.main()
