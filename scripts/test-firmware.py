#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Run Toit tests and verify success markers as some runtimes exit zero on throw."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
for name in ('model', 'controller'):
    result = subprocess.run(['toit', 'run', f'firmware/tests/{name}-test.toit'], cwd=root, text=True, capture_output=True)
    print(result.stdout, end='')
    print(result.stderr, end='', file=sys.stderr)
    if result.returncode or f'Firmware {name} tests passed' not in result.stdout:
        raise SystemExit(1)
