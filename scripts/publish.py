#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Create the authorized public floitsch/led-3d repository and enable Pages.

Run only with authenticated gh and network access. An existing repository
is never overwritten. Publication uses a clean temporary checkout.
"""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'floitsch/led-3d'
spec = importlib.util.spec_from_file_location('source_package', ROOT / 'scripts/package-source.py')
source_package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_package)


def run(*args, cwd=ROOT):
    return subprocess.run(args, cwd=cwd, check=True)


if __name__ == '__main__':
    run('gh', 'auth', 'status')
    # Query the authenticated account first, so a network failure cannot be
    # mistaken for a missing repository.
    run('gh', 'api', 'user', '--jq', '.login')
    existing = subprocess.run(['gh', 'repo', 'view', REPOSITORY, '--json', 'name'], capture_output=True)
    if existing.returncode == 0:
        raise SystemExit('Repository already exists. Inspect it and publish through its checkout; this script will not overwrite it.')
    if b'Could not resolve to a Repository' not in existing.stderr and b'404' not in existing.stderr:
        raise SystemExit('Could not establish whether the repository exists. No changes made.')
    with tempfile.TemporaryDirectory(prefix='led-3d-publish-') as temporary:
        checkout = Path(temporary)
        for source, relative in source_package.sources():
            destination = checkout / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        run('git', 'init', '--initial-branch=main', cwd=checkout)
        run('git', 'add', '.', cwd=checkout)
        run('git', 'commit', '-m', 'Implement browser-based 3D LED mapping and Toit companion', cwd=checkout)
        run('gh', 'repo', 'create', REPOSITORY, '--public', '--description', 'Map addressable LEDs in 3D with an Android browser and a Toit-powered ESP32', '--source', str(checkout), '--remote', 'origin', cwd=checkout)
        run('git', 'push', '-u', 'origin', 'main', cwd=checkout)
        # Enable Pages while the build/test job runs, before its deployment job.
        run('gh', 'api', '--method', 'POST', f'repos/{REPOSITORY}/pages', '-f', 'build_type=workflow', cwd=checkout)
    print('Source pushed. Watch the GitHub Actions build for verified deployment status.')
