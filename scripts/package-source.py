#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Package explicit public source paths; exclude caches, device data, and credentials."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ['package.json', '.gitignore', 'LICENSE', 'README.md', 'THIRD_PARTY.md',
          '.github', 'scripts', 'tests', 'firmware/package.yaml',
          'firmware/package.lock', 'firmware/LICENSE', 'firmware/src',
          'firmware/tests', 'web']


def sources():
    for entry in PUBLIC:
        path = ROOT / entry
        for file in ([path] if path.is_file() else sorted(path.rglob('*'))):
            relative = file.relative_to(ROOT)
            if not file.is_file() or '__pycache__' in relative.parts:
                continue
            if relative.parts[:2] == ('web', 'firmware'):
                continue
            yield file, relative


if __name__ == '__main__':
    output = ROOT / 'dist/source.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file, relative in sources():
            archive.write(file, relative)
    print(f'Source archive: {output}')
