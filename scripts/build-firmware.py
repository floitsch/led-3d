#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Build a credential-free ESP32 bundle. Wi-Fi is inserted in the browser."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def decode_ubjson(data):
    position = 0

    def read(marker=None):
        nonlocal position
        if marker is None:
            marker = chr(data[position])
            position += 1
        if marker in 'UiIlL':
            fmt = {'U': '>B', 'i': '>b', 'I': '>h', 'l': '>i', 'L': '>q'}[marker]
            result = struct.unpack_from(fmt, data, position)[0]
            position += struct.calcsize(fmt)
            return result
        if marker == 'S':
            length = read()
            result = data[position:position + length].decode()
            position += length
            return result
        if marker == '{':
            assert data[position] == ord('#')
            position += 1
            result = {}
            for _ in range(read()):
                length = read()
                key = data[position:position + length].decode()
                position += length
                result[key] = read()
            return result
        if marker == '[':
            kind = None
            if data[position] == ord('$'):
                kind = chr(data[position + 1])
                position += 2
            assert data[position] == ord('#')
            position += 1
            return [read(kind) for _ in range(read())]
        raise ValueError(f'Unsupported UBJSON marker {marker}')
    result = read()
    if position != len(data):
        raise ValueError('Trailing UBJSON data')
    return result


def build(envelope, toit):
    def run(*args):
        return subprocess.check_output([toit, *map(str, args)], cwd=ROOT)
    info = json.loads(run('tool', 'firmware', '-e', envelope, 'show', '--output-format', 'json'))
    sdk = run('version').decode().strip()
    if info['sdk-version'] != sdk:
        raise ValueError(f'Envelope SDK {info["sdk-version"]} does not match compiler {sdk}')
    chip = info['chip']
    if chip not in ('esp32', 'esp32s3', 'esp32c3', 'esp32c6', 'esp32s2'):
        raise ValueError('Unsupported chip')
    if set(info['containers']) != {'system'}:
        raise ValueError('Use a clean system envelope, without existing applications')
    directory = ROOT / 'build' / chip
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'firmware.envelope'
    shutil.copyfile(envelope, target)
    # Reject envelopes with personal configuration; never publish credentials.
    archive = target.read_bytes()
    if archive[:8] != b'!<arch>\n':
        raise ValueError('Invalid envelope archive')
    pos = 8
    while pos < len(archive):
        header = archive[pos:pos + 60]
        size = int(header[48:58])
        name = header[:16].decode().strip().rstrip('/')
        pos += 60
        if name == '$properties':
            properties = json.loads(archive[pos:pos + size])
            if set(properties) - {'$container-flags'}:
                raise ValueError('Envelope has custom properties; supply a clean release envelope')
        pos += size + size % 2
    snapshot = directory / 'main.snapshot'
    run('analyze', '-Werror', 'firmware/src/main.toit')
    run('compile', '-Werror', '-O2', '-s', '-o', snapshot, 'firmware/src/main.toit')
    run('tool', 'firmware', '-e', target, 'container', 'install', 'led-3d', snapshot)
    run('tool', 'firmware', '-e', target, 'extract', '--format=image', '-o', directory / 'firmware.bin')
    run('tool', 'firmware', '-e', target, 'extract', '--format=ubjson', '-o', directory / 'firmware.ubjson')
    export = decode_ubjson((directory / 'firmware.ubjson').read_bytes())
    image = (directory / 'firmware.bin').read_bytes()
    app = bytes(export['binary'])
    # Match the complete app in the image and require an unambiguous location.
    offset = image.find(app)
    if offset < 0 or image.find(app, offset + 1) >= 0:
        raise ValueError('Cannot unambiguously locate the application image')
    config = next(p for p in export['parts'] if p['type'] == 'config')
    manifest = {'version': 1, 'chip': chip, 'sdk': sdk, 'flashSize': '4MB',
                'appOffset': offset, 'appSize': len(app),
                'configOffset': offset + config['from'], 'configSize': config['to'] - config['from'],
                'sha256': hashlib.sha256(image).hexdigest()}
    if len(image) > 4 * 1024 * 1024:
        raise ValueError('Image exceeds supported 4 MiB flash layout')
    output = ROOT / 'web' / 'firmware'
    output.mkdir(exist_ok=True)
    (output / f'{chip}.json').write_text(json.dumps({'manifest': manifest, 'image': base64.b64encode(image).decode()}) + '\n')
    index = output / 'index.json'
    available = json.loads(index.read_text()) if index.exists() else {'version': 1, 'chips': {}}
    available['chips'][chip] = f'{chip}.json'
    index.write_text(json.dumps(available, indent=2) + '\n')
    print(f'Built {chip}: {len(image)} bytes, SDK {sdk}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--envelope', type=Path, required=True)
    parser.add_argument('--toit', default='toit')
    args = parser.parse_args()
    build(args.envelope.resolve(), args.toit)
