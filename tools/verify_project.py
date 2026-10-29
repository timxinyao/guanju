#!/usr/bin/env python3
"""Run reproducible, device-free checks for the public project."""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.git', '.worktrees', '.venv', '.esphome', '.pio', 'build', 'output', 'artifacts', 'local', '__pycache__', 'node_modules'}
PRIVATE_PATH = re.compile(r'(?:/Users/|/home/|[A-Za-z]:\\Users\\)')
IPV4 = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')
LINK = re.compile(r'!?\[[^\]]+\]\(([^)]+)\)')
CREDENTIAL = re.compile(r'^\s*(?:password|sony_tv_psk|home_wifi_password|radar_ap_password)\s*:\s*(?!\s*(?:!secret\b|#|$))\S+', re.MULTILINE)


def public_issues(root):
    """Return rule names and relative paths only, never matching content."""
    issues = []
    candidates = []
    for path in root.glob('*.md'):
        if path.is_file() and not path.is_symlink() and not path.name.startswith('secrets'):
            candidates.append(path)
    for name in ('docs', 'design', 'firmware', '.github'):
        base = root / name
        if not base.exists():
            continue
        for current, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in EXCLUDED and not d.startswith('.')]
            for name in files:
                path = Path(current) / name
                if name.startswith('secrets') or path.is_symlink() or path.suffix not in ('.md', '.yaml'):
                    continue
                candidates.append(path)
    for path in candidates:
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding='utf-8')
        if PRIVATE_PATH.search(text):
            issues.append(f'{rel}: private path')
        if path.suffix == '.yaml' and CREDENTIAL.search(text):
            issues.append(f'{rel}: literal credential')
        if path.suffix == '.md':
            for match in IPV4.finditer(text):
                try:
                    ip = ipaddress.IPv4Address(match.group())
                except ValueError:
                    continue
                # The AP address is the standard ESPHome fallback address.
                if (ip.is_private and not ip.is_loopback and
                    not ip in ipaddress.IPv4Network('192.0.2.0/24') and str(ip) != '192.168.4.1'):
                    issues.append(f'{rel}: private IP')
                    break
        if path.suffix == '.md':
            for match in LINK.finditer(text):
                raw_target = match.group(1).strip()
                target = raw_target[1:].split('>', 1)[0] if raw_target.startswith('<') else raw_target.split(maxsplit=1)[0]
                if not target or target.startswith(('#', '/')) or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
                    continue
                target = unquote(target.split('#', 1)[0].split('?', 1)[0])
                if target and not (path.parent / target).exists():
                    issues.append(f'{rel}: broken link')
    return issues


def run(command):
    print('+', ' '.join(str(arg) for arg in command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def verify_config():
    with tempfile.TemporaryDirectory(prefix='guanju-config-') as folder:
        target = Path(folder) / 'firmware'
        shutil.copytree(ROOT / 'firmware', target, ignore=shutil.ignore_patterns(
            'secrets*', '.esphome', 'build', '__pycache__'))
        shutil.copyfile(ROOT / 'firmware/secrets.example.yaml', target / 'secrets.yaml')
        for name in ('radar-observer.yaml', 'radar-network-observer.yaml', 'tv-trial.yaml'):
            print(f'+ ESPHome example config: {name}', flush=True)
            # Config output can contain credentials; never display or persist it.
            result = subprocess.run([sys.executable, '-m', 'esphome', 'config', str(target / name)],
                                    cwd=target, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode:
                raise RuntimeError(f'ESPHome config failed for {name} (exit {result.returncode})')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', action='store_true', help='also validate all YAML with example secrets in a temporary copy')
    args = parser.parse_args()
    try:
        run(['sh', 'tests/run_tv_trial_tests.sh'])
        for test in sorted((ROOT / 'firmware/ui').glob('*.test.cjs')):
            run(['node', str(test.relative_to(ROOT))])
        run(['node', '--check', 'firmware/ui/app.js'])
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'])
        with tempfile.TemporaryDirectory(prefix='guanju-icon-') as folder:
            generated = Path(folder) / 'icon.h'
            run([sys.executable, 'tools/embed_app_icon.py', 'firmware/ui/apple-touch-icon.png', str(generated)])
            if generated.read_bytes() != (ROOT / 'firmware/tv_trial_app_icon_data.h').read_bytes():
                raise RuntimeError('PNG embedded header is out of date')
        issues = public_issues(ROOT)
        if issues:
            for issue in issues:
                print(issue, file=sys.stderr)
            raise RuntimeError('public file checks failed')
        if args.config:
            verify_config()
        print('Project verification passed')
    except (subprocess.CalledProcessError, OSError, RuntimeError) as exc:
        print(f'Verification failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
