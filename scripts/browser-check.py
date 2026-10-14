#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Exercise real UI/workers with mocked device I/O. Does not test physical LNA/USB."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def check(browser_path):
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT / 'web')))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    artifacts = ROOT / 'build/browser'
    artifacts.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**({'executable_path': browser_path} if browser_path else {'channel': 'chrome'}))
            print(f'Testing Google Chrome {browser.version}')
            (artifacts / 'browser-version.txt').write_text(f'Google Chrome {browser.version}\n')
            context = browser.new_context(viewport={'width': 1280, 'height': 960})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            config = {'pin': 18, 'count': 80, 'order': 'GRB'}
            saved = {}

            def device(route):
                endpoint = route.request.url.split('/api/')[-1]
                headers = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'Content-Type, X-LED-Key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'}
                if route.request.method == 'OPTIONS':
                    route.fulfill(status=204, headers=headers)
                    return
                if endpoint == 'status':
                    response = {'version': 1, 'hostname': 'led-test.local', 'config': config, 'mode': 'off', 'hasMap': bool(saved.get('map')), 'error': None}
                elif route.request.method == 'POST':
                    saved[endpoint] = route.request.post_data_json
                    response = {'ok': True}
                else:
                    response = saved.get(endpoint)
                route.fulfill(json=response, headers=headers)

            context.route('http://led-test.local/**', device)
            page.goto(base)
            page.locator('#address').fill('led-test.local')
            page.get_by_text('Pairing key', exact=True).click()
            page.locator('#device-key').fill('a' * 32)
            page.get_by_role('button', name='Connect over Wi-Fi').click()
            page.wait_for_function("document.getElementById('connection').textContent.includes('Connected')")
            page.get_by_role('button', name='Save strip settings').click()
            page.wait_for_function("document.getElementById('notice').textContent.includes('Strip settings saved')")
            page.get_by_role('button', name='03 Scan').click()
            # A pending camera permission request must not permit another scan
            # or navigation away into settings while startup is still running.
            page.evaluate("""() => {
              window.originalGetUserMedia = navigator.mediaDevices.getUserMedia;
              navigator.mediaDevices.getUserMedia = () => new Promise((resolve, reject) => {
                window.rejectTestCamera = reject;
              });
            }""")
            page.get_by_role('button', name='Start camera & scan').click()
            page.wait_for_function("typeof window.rejectTestCamera === 'function'")
            assert page.locator('#demo').is_disabled()
            assert page.locator('#new-capture').is_disabled()
            page.get_by_role('button', name='02 Connect').click()
            assert page.locator('#scan').is_visible()
            page.evaluate("""() => {
              navigator.mediaDevices.getUserMedia = window.originalGetUserMedia;
              window.rejectTestCamera(new DOMException('Test camera permission denied', 'NotAllowedError'));
            }""")
            page.wait_for_function("!document.getElementById('start-scan').disabled")
            # Hold reconstruction and its stop response separately. Cancellation
            # must keep scan/navigation locked until the device has stopped.
            page.evaluate("""() => {
              window.originalWorker = window.Worker;
              window.Worker = class { postMessage() {} terminate() {} };
              window.originalFetch = window.fetch;
              window.fetch = (url, options) => String(url).endsWith('/api/stop')
                ? new Promise(resolve => { window.resolveTestStop = () => resolve(
                    new Response(JSON.stringify({ok: true}), {headers: {'Content-Type': 'application/json'}})); })
                : window.originalFetch(url, options);
            }""")
            page.get_by_role('button', name='Try a simulated scan').click()
            page.locator('#cancel-scan').click()
            page.wait_for_function("typeof window.resolveTestStop === 'function'")
            assert page.locator('#start-scan').is_disabled()
            assert page.locator('#demo').is_disabled()
            assert page.locator('#new-capture').is_disabled()
            page.get_by_role('button', name='02 Connect').click()
            assert page.locator('#scan').is_visible()
            page.evaluate("""() => {
              window.Worker = window.originalWorker;
              window.fetch = window.originalFetch;
              window.resolveTestStop();
            }""")
            page.wait_for_function("!document.getElementById('start-scan').disabled")
            page.get_by_role('button', name='Try a simulated scan').click()
            page.wait_for_function("!document.getElementById('play').hidden", timeout=120000)
            print(page.locator('#map-summary').inner_text())
            assert '80 measured' in page.locator('#map-summary').inner_text()
            page.locator('#effect').select_option('fire')
            page.locator('#rotate-z').evaluate("el => { el.value = '90'; el.dispatchEvent(new Event('input', {bubbles: true})); }")
            page.get_by_role('button', name='Save positions to ESP32').click()
            page.wait_for_function("document.getElementById('notice').textContent.includes('Positions saved')")
            assert len(saved['map']['points']) == 80
            page.get_by_role('button', name='Play on lights').click()
            page.wait_for_function("document.getElementById('notice').textContent.includes('Playing on')")
            assert saved['effect']['name'] == 'fire'
            with page.expect_download() as download:
                page.get_by_role('button', name='Download positions').click()
            downloaded = json.loads(Path(download.value.path()).read_text())
            assert downloaded['count'] == 80
            page.screenshot(path=str(artifacts / 'desktop.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'Mobile horizontal overflow'
            page.screenshot(path=str(artifacts / 'mobile.png'), full_page=True)
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('Browser checks passed (device API mocked)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Path to an existing Google Chrome executable; defaults to the stable Chrome channel')
    check(parser.parse_args().browser)
