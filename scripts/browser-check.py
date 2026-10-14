#!/usr/bin/env python3
# Copyright (C) 2026 Toit contributors. MIT license; see LICENSE.
"""Exercise UI, video capture, and workers with simulated camera/device input."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import math
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def check_setup(browser, base, artifacts):
    desktop = browser.new_context(viewport={'width': 1280, 'height': 960})
    # Keep real settings validation but simulate USB flashing. Provisioning
    # checksums are covered separately; this checks the two-device workflow.
    installer = (ROOT / 'web/lib/installer.js').read_text().split('export async function flash(')[0]
    installer += '''export async function flash(settings, {onStatus, onProgress}) {
      window.testProvisionedSettings = settings;
      onProgress(100); onStatus('Installed test controller.');
    }'''
    desktop.route('**/lib/installer.js', lambda route: route.fulfill(body=installer, content_type='text/javascript'))
    desktop.route('https://esm.sh/qrcode@1.5.4', lambda route: route.fulfill(
        body='export default {toCanvas: async () => {}};', content_type='text/javascript'))
    setup = desktop.new_page()
    setup.goto(base + '/setup.html')
    assert setup.locator('#start-scan').count() == 0
    setup.locator('#ssid').fill('test-network')
    setup.locator('#password').fill('test-password')
    setup.locator('#hostname').fill('led-test')
    setup.get_by_role('button', name='Install & configure Wi-Fi').click()
    setup.locator('#installed').wait_for(state='visible')
    pairing_key = setup.locator('#saved-key').input_value()
    assert len(pairing_key) == 32
    assert setup.locator('#saved-address').input_value() == 'led-test.local'
    assert setup.locator('#password').input_value() == ''
    link = setup.locator('#phone-link').input_value()
    assert '/capture.html#' in link
    assert setup.evaluate('window.testProvisionedSettings.key') == pairing_key
    setup.reload()
    setup.locator('#installed').wait_for(state='visible')
    assert setup.locator('#saved-key').input_value() == pairing_key
    setup.screenshot(path=str(artifacts / 'setup-desktop.png'), full_page=True)
    desktop.close()

    # A phone gets no desktop cookies or localStorage. Both the explicit link
    # and old root-page installation links must work in a fresh browser.
    for target in [link, link.replace('/capture.html#', '/#')]:
        phone = browser.new_context()
        page = phone.new_page()
        page.goto(target)
        page.wait_for_function("document.getElementById('device-key')?.value.length === 32")
        assert page.locator('#address').input_value() == 'led-test.local'
        assert page.locator('#device-key').input_value() == pairing_key
        assert 'capture.html' in page.url and 'key=' not in page.url
        page.reload()
        page.wait_for_function("document.getElementById('device-key')?.value.length === 32")
        phone.close()
    return pairing_key


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
            pairing_key = check_setup(browser, base, artifacts)
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
                if route.request.headers.get('x-led-key') != pairing_key:
                    route.fulfill(status=401, json={'error': 'Invalid pairing key'}, headers=headers)
                    return
                if endpoint == 'status':
                    response = {'version': 1, 'hostname': 'led-test.local', 'config': config, 'mode': 'off', 'hasMap': bool(saved.get('map')), 'error': None}
                elif route.request.method == 'POST':
                    saved[endpoint] = route.request.post_data_json
                    if endpoint == 'config':
                        config.update(saved[endpoint])
                    response = {'ok': True}
                else:
                    response = saved.get(endpoint)
                route.fulfill(json=response, headers=headers)

            context.route('http://led-test.local/**', device)
            page.goto(base + '/capture.html')
            assert page.locator('#device-key').input_value() == ''
            assert page.locator('#install-form').count() == 0
            page.locator('#address').fill('led-test.local')
            page.locator('#device-key').fill(pairing_key)
            page.get_by_role('button', name='Connect over Wi-Fi').click()
            page.wait_for_function("document.getElementById('connection').textContent.includes('Connected')")
            # The device may report defaults before its GPIO is initialized.
            page.get_by_role('button', name='Save strip settings').click()
            page.wait_for_function("document.getElementById('notice').textContent.includes('LED 80 is lit')")
            assert saved['config']['count'] == 80 and saved['test']['index'] == 79
            # One count field drives both configuration and the last-LED test.
            assert page.locator('#test-index').count() == 0
            page.locator('#count').fill('105')
            page.locator('#count').press('Tab')
            page.wait_for_function("document.getElementById('notice').textContent.includes('LED 105 is lit')")
            assert saved['config']['count'] == 105 and saved['test']['index'] == 104
            page.locator('#count').fill('80')
            page.locator('#count').press('Tab')
            page.wait_for_function("document.getElementById('notice').textContent.includes('LED 80 is lit')")
            assert saved['config']['count'] == 80 and saved['test']['index'] == 79
            page.get_by_role('button', name='Scan', exact=True).click()
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
            page.get_by_role('button', name='Connect', exact=True).click()
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
            page.wait_for_function("document.getElementById('solve-time').textContent.startsWith('1s elapsed')")
            assert page.locator('#solve-progress').is_visible()
            page.locator('#cancel-scan').click()
            page.wait_for_function("typeof window.resolveTestStop === 'function'")
            assert page.locator('#start-scan').is_disabled()
            assert page.locator('#demo').is_disabled()
            assert page.locator('#new-capture').is_disabled()
            page.get_by_role('button', name='Connect', exact=True).click()
            assert page.locator('#scan').is_visible()
            page.evaluate("""() => {
              window.Worker = window.originalWorker;
              window.fetch = window.originalFetch;
              window.resolveTestStop();
            }""")
            page.wait_for_function("!document.getElementById('start-scan').disabled")
            # A large candidate-view count may still export no identified views.
            # The failure must be visible even while the ESP32 stop request hangs.
            page.evaluate((ROOT / 'tests/live-camera.js').read_text())
            page.evaluate('''() => {
              window.Worker = class {
                postMessage(message) {
                  if(message.type === 'start') this.count = message.count;
                  if(message.type === 'frame') setTimeout(() => this.onmessage?.({data: {type:'frame',tracks:[],frames:93}}), 0);
                  if(message.type === 'finish') setTimeout(() => this.onmessage?.({data: {type:'capture',capture:{version:1,count:this.count,width:480,height:360,frames:[]}}}), 0);
                }
                terminate() {}
              };
              window.resolveTestStop = null;
              window.fetch = (url, options) => String(url).endsWith('/api/stop')
                ? new Promise(resolve => { window.resolveTestStop = () => resolve(window.originalFetch(url, options)); })
                : window.originalFetch(url, options);
            }''')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('#new-capture').click()
            page.locator('#start-scan').click()
            try:
                page.wait_for_function("document.getElementById('keyframes').textContent === '93'", timeout=10000)
            except Exception:
                print(page.locator('#scan-status').inner_text(), page.locator('#notice').inner_text(), errors, flush=True)
                raise
            assert page.locator('#camera-panel').evaluate('el => {const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;}')
            page.locator('#finish-scan').scroll_into_view_if_needed()
            assert page.locator('#camera-panel').evaluate('el => {const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;}')
            page.screenshot(path=str(artifacts / 'mobile-camera.png'))
            page.locator('#finish-scan').click()
            page.wait_for_function("document.getElementById('scan-status').textContent.includes('Only 0 usable views')")
            assert page.locator('#solve-progress').is_hidden()
            assert page.locator('#export-capture').is_enabled()
            with page.expect_download() as download:
                page.locator('#export-capture').click()
            assert json.loads(Path(download.value.path()).read_text())['frames'] == []
            page.evaluate('''() => {
              window.Worker = window.originalWorker;
              window.fetch = window.originalFetch;
              window.resolveTestStop();
              window.cameraFixture.restore();
            }''')
            page.wait_for_function("!document.getElementById('start-scan').disabled")
            page.set_viewport_size({'width':1280, 'height':960})
            page.get_by_role('button', name='Try a simulated scan').click()
            page.wait_for_function("!document.getElementById('play').hidden", timeout=120000)
            print(page.locator('#map-summary').inner_text())
            assert '80 measured' in page.locator('#map-summary').inner_text()
            # Fixed colors make canvas comparisons deterministic: both touch
            # dragging and explicit controls must rotate without changing the map.
            page.locator('#effect').select_option('off')
            page.wait_for_timeout(80)
            before_view = page.locator('#viewer').screenshot()
            page.locator('#view-right').click()
            page.wait_for_timeout(80)
            assert page.locator('#viewer').screenshot() != before_view
            page.locator('#view-reset').click()
            page.wait_for_timeout(80)
            assert page.locator('#viewer').screenshot() == before_view
            cdp = context.new_cdp_session(page)
            box = page.locator('#viewer').bounding_box()
            x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+70,'y':y+25}]})
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
            page.wait_for_timeout(80)
            assert page.locator('#viewer').screenshot() != before_view
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

            # Exercise the actual live video path, rather than starting from
            # precomputed point observations as the demonstration does.
            page.set_viewport_size({'width': 1280, 'height': 960})
            page.get_by_role('button', name='Connect', exact=True).click()
            page.locator('#count').fill('30')
            page.get_by_role('button', name='Save strip settings').click()
            page.wait_for_function("document.getElementById('notice').textContent.includes('Strip settings saved')")
            page.get_by_role('button', name='Scan', exact=True).click()
            page.locator('#new-capture').click()
            page.get_by_text('Capture files & camera calibration', exact=True).click()
            page.locator('#focal').fill('500')
            page.evaluate((ROOT / 'tests/live-camera.js').read_text())
            page.locator('#start-scan').click()
            page.wait_for_function("window.cameraFixture.elapsed >= 18", timeout=30000)
            identified = int(page.locator('#identified').inner_text())
            print(f'Live capture final view: {identified}/30 identified')
            assert int(page.locator('#keyframes').inner_text()) >= 20
            page.screenshot(path=str(artifacts / 'live-capture.png'), full_page=True)
            page.evaluate('''() => {
              window.resolveTestStop = null;
              window.fetch = (url, options) => String(url).endsWith('/api/stop')
                ? new Promise(resolve => { window.resolveTestStop = () => resolve(window.originalFetch(url, options)); })
                : window.originalFetch(url, options);
            }''')
            page.locator('#finish-scan').click()
            page.wait_for_function("!document.getElementById('play').hidden || (!document.getElementById('start-scan').disabled && document.getElementById('scan-status').textContent !== 'Finishing capture…')", timeout=120000)
            status = page.locator('#scan-status').inner_text()
            succeeded = page.locator('#play').is_visible()
            assert page.locator('#send-effect').is_disabled()
            assert page.locator('#solve-progress').is_hidden()
            page.evaluate('''() => {window.fetch=window.originalFetch;window.resolveTestStop();}''')
            page.wait_for_function("!document.getElementById('start-scan').disabled")
            page.get_by_role('button', name='Scan', exact=True).click()
            with page.expect_download() as download:
                page.locator('#export-capture').click()
            live_capture = json.loads(Path(download.value.path()).read_text())
            (artifacts / 'live-observations.json').write_text(json.dumps(live_capture))
            assert succeeded, status
            page.get_by_role('button', name='Play', exact=True).click()
            assert page.evaluate("window.cameraFixture.stream.getTracks().every(t => t.readyState === 'ended')")
            assert 'scan' in saved and 'stop' in saved
            with page.expect_download() as download:
                page.get_by_role('button', name='Download positions').click()
            live_map = json.loads(Path(download.value.path()).read_text())
            points = page.evaluate('window.cameraFixture.points')
            measured = [led for led in live_map['leds'] if led['status'] == 'measured']
            assert len(measured) >= 27, f'Only {len(measured)}/30 LEDs reconstructed from live video'
            pairs = [(math.dist(a['position'], b['position']), math.dist(points[a['id']], points[b['id']]))
                     for i, a in enumerate(measured) for b in measured[i + 1:]]
            scale = sum(a * b for a, b in pairs) / sum(a * a for a, _ in pairs)
            error = math.sqrt(sum((a * scale - b) ** 2 for a, b in pairs) / sum(b * b for _, b in pairs))
            assert error < .05, f'Live capture relative shape error {error:.2%}'
            print(f'Live video: {len(measured)}/30 LEDs reconstructed, relative shape error {error:.2%}')
            (artifacts / 'live-capture-map.json').write_text(json.dumps(live_map))
            page.evaluate('window.cameraFixture.restore()')
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
