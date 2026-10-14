#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Check the published HTTPS app against real LAN HTTP with Chrome permission.

The HTTP server simulates device status; no ESP32 or camera is exercised.
Use --bind with this computer's private LAN IPv4 address, not loopback.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import secrets
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright


def check(address, site):
    ip = ipaddress.ip_address(address)
    if ip.version != 4 or not ip.is_private or ip.is_loopback or ip.is_unspecified:
        raise ValueError('Use this computer\'s private LAN IPv4 address')
    url = urlsplit(site)
    if url.scheme != 'https':
        raise ValueError('The app must be served over HTTPS')
    origin = f'{url.scheme}://{url.netloc}'
    token = secrets.token_hex(16)
    observed = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_OPTIONS(self):
            observed.append('OPTIONS')
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'X-LED-Key')
            self.end_headers()

        def do_GET(self):
            if self.path != '/api/status' or self.headers.get('X-LED-Key') != token:
                self.send_error(403)
                return
            observed.append('GET')
            data = json.dumps({'version': 1, 'hostname': 'lan-test',
                               'config': {'pin': 32, 'count': 100, 'order': 'GRB'},
                               'mode': 'off', 'hasMap': False, 'error': None}).encode()
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer((address, 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome')
            context = browser.new_context()
            context.grant_permissions(['local-network-access'], origin=origin)
            page = context.new_page()
            page.goto(site)
            assert page.evaluate('isSecureContext')
            page.locator('#address').fill(f'{address}:{server.server_port}')
            page.locator('#device-key').fill(token)
            page.get_by_role('button', name='Connect over Wi-Fi').click()
            page.wait_for_function("document.getElementById('connection').textContent.includes('Connected')")
            assert observed == ['OPTIONS', 'GET'], observed
            print(f'Chrome {browser.version}: HTTPS-to-LAN HTTP connection passed with CORS preflight')
            print('Local-network permission granted by automation; device status simulated over a real socket')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', required=True)
    parser.add_argument('--site', default='https://floitsch.github.io/led-3d/capture.html')
    args = parser.parse_args()
    check(args.bind, args.site)
