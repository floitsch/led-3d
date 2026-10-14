# LED 3D

Map an individually addressable LED string in 3D by walking around it with
an Android phone. A Toit companion controls the ESP32; the browser does the
video analysis and reconstruction. There is no application server and no
video upload.

The supported browser is the latest stable Google Chrome: desktop Chrome for
USB installation and Android Chrome for capture. Other browsers and older
Chrome releases are outside the support target.

**Status:** the [HTTPS app](https://floitsch.github.io/led-3d/) is deployed.
Numerical tests, firmware model tests, and Chrome UI tests pass in
[GitHub Actions](https://github.com/floitsch/led-3d/actions). Physical
ESP32/LED/Android validation is still in progress. Do not interpret the
simulated demonstration as proof of real-camera accuracy.

## User workflow

1. Open [setup](https://floitsch.github.io/led-3d/setup.html) in desktop Chrome
   and connect an ESP32 by USB.
2. Enter Wi-Fi credentials and a device name, then install. The browser
   detects the chip and inserts the configuration into a prebuilt Toit image.
   Installation replaces the board's existing firmware and stored settings.
3. Independently open [capture](https://floitsch.github.io/led-3d/capture.html)
   in Android Chrome. Enter the device address and pairing key shown by setup,
   or scan its optional QR code to fill them automatically. Keep the phone and
   ESP32 on the same Wi-Fi and allow local-network access. The PC and its setup
   tab can be closed; the phone communicates directly with the ESP32.
4. Select the data GPIO and color order. Changing the LED count saves the
   length and lights that last LED automatically; adjust it until the final
   physical LED lights. Test all three colors. The
   supported configuration range is 1–1024 LEDs; reconstruction needs at least
   12 shared LEDs to initialize and at least three overlapping views. Large strings still need
   hardware/performance testing.
5. Start the camera. Walk slowly around the object while the LEDs display
   repeating identification colors. The UI shows identified tracks and
   captured views. No deliberate pauses or object measurements are required.
6. Finish and watch reconstruction progress and elapsed time. Processing
   continues even if the ESP32 stop response is slow. Capture data can be
   downloaded or reconstruction cancelled and retried. Drag the 3D result
   with a finger or mouse, or use the view rotation buttons to inspect it.
   Capture more views if necessary. Set the orientation, optionally estimate
   short gaps, and save the positions.
7. Select fire, rising rings, a left/right sweep, or spatial rainbow. Effects
   run on the ESP32 and resume after reboot. The browser can disconnect.

Setup and capture are separate pages with separate scripts. The phone does
not need to have visited setup or share browser state with the PC. Bookmark
the capture page to return later; it remembers that phone's connection details.
Setup also remembers its last connection details for reopening the QR code
without reflashing. Old root-page installation links continue to work.

Current capture sessions stop after 80 seconds; additional sessions can be
combined. Keep the object still and use the same lens, zoom, and phone
orientation throughout. Keep enough LEDs shared between successive views.
Dim the lights if their colors saturate to white or neighboring spots merge.

## Where the code runs

| Component | Location and responsibility |
| --- | --- |
| Static website | GitHub Pages serves `web/` and prebuilt firmware bundles. |
| Setup page (`setup.html`) | PC browser USB flashing using esptool-js; Wi-Fi provisioning and phone connection details. |
| Capture page (`capture.html`) | Independent phone UI for Wi-Fi connection, scanning, saved maps, and effects. |
| Capture worker | Browser: connected-component detection, tracking, temporal identity decoding. |
| Reconstruction worker | Browser: camera poses, triangulation, outlier rejection, bundle refinement. |
| Toit companion | ESP32: mDNS, HTTP API, `pixel-strip` output, configuration/map storage, effects. |

The HTTPS page talks directly to `http://name.local` using Chrome's
local-network permission and normal CORS. No cloud relay, ESP32 TLS
certificate, or camera capture from an HTTP page is involved. A tiny local
device page links back to the HTTPS app. A private IPv4 address is accepted
as a fallback if mDNS does not resolve.

Firmware accepts the website origin `https://floitsch.github.io`. For a fork
or development origin, update `ORIGIN` and `SITE` in `firmware/src/main.toit`
and rebuild. Device API requests also require a random pairing key generated
at installation. It is included in the phone link's URL fragment (not sent
to GitHub), then retained in the browser's local storage. A local-network
HTTP connection assumes a trusted Wi-Fi network; it is not encrypted.

Source: [github.com/floitsch/led-3d](https://github.com/floitsch/led-3d).
App: [floitsch.github.io/led-3d](https://floitsch.github.io/led-3d/).

## Development

The application has no npm build dependencies. Node 20+ and Python 3 are enough
to run the static app and numerical tests:

```sh
npm test
npm run serve
# Open http://localhost:8080/capture.html and choose Scan → Try a simulated scan.
npm run build
```

Camera access from another device requires HTTPS; an ordinary LAN HTTP URL
for the development server is insufficient. Localhost is suitable for the
desktop demonstration. Deploy the static app to test Android camera access.

To build firmware, install Toit SDK `v2.0.0-alpha.199`, then:

```sh
toit pkg --project-root firmware install
toit analyze -Werror firmware/src/main.toit firmware/tests/model-test.toit firmware/tests/controller-test.toit
python3 scripts/test-firmware.py
python3 scripts/build-firmware.py --envelope /path/to/firmware-esp32.envelope
```

Use a clean envelope with only its system container. Download matching SDK
and envelope versions from the Toit releases; the builder rejects mismatches
and envelopes containing custom properties or application containers.
For another variant, supply its matching envelope. The installer detects
ESP32/ESP32-S2/S3/C3/C6 chip names and refuses mismatched images. Published
builds currently target classic ESP32 and ESP32-S3; the other targets require
their own bundle and validation. Boards need at least 4 MiB flash.

Outputs are `web/firmware/<chip>.json` and `build/<chip>/`, including a
snapshot for crash decoding. Firmware bundles are generated, not checked in.
The local S3 validation bundle was built with the available development SDK
`v2.0.0-alpha.199.35+floitsch-i2s-tx-resume.210eb1d2`; the CI workflow rebuilds
S3 using the pinned public release SDK before publishing. Classic ESP32 uses
the public `v2.0.0-alpha.199` SDK locally as well.
The browser verifies the bundle SHA-256, writes the UBJSON configuration
region, and recomputes the ESP image checksum and SHA-256 before flashing.
The SDK/envelope is never modified in place.

`scripts/browser-check.py` checks setup and capture in isolated browser
profiles, including manual pairing, optional connection links, and saved
connection details after a reload. USB flashing is simulated for this UI test.
Regressions cover automatic last-LED testing, mobile camera visibility, touch
rotation, visible failure after 93 candidate views with no identified views,
and successful reconstruction while the device stop response is delayed.
It also exercises the real UI, live video capture pipeline,
reconstruction worker, responsive layout, and simulated device API with
Playwright. A generated 18-second video stream moves continuously around
known LEDs with camera shake. The test checks recovered geometry, stops the
video tracks, and saves the captured observations for diagnosis. It launches
Google Chrome's stable channel by default and accepts `--browser` for an
existing Google Chrome executable. It needs an environment that permits
browser processes and localhost sockets. CI installs the latest stable Chrome
and current Playwright; each run records the Chrome version in its validation
artifacts. To prepare a local test environment, run:

```sh
python3 -m pip install --upgrade playwright
python3 -m playwright install --with-deps chrome
python3 scripts/browser-check.py
```

To check the published HTTPS app against an actual local HTTP socket, run
`python3 scripts/local-network-check.py --bind <this-computer-LAN-IP>`.
This uses Chrome with local-network permission granted by automation and
checks CORS preflight plus the authenticated status request. It simulates
device status, so it does not replace the ESP32/Android connection test.

With GitHub CLI authenticated and network access available,
`python3 scripts/publish.py` creates the public `floitsch/led-3d` repository,
pushes an explicit set of source files from a temporary checkout, and enables
GitHub Pages. It refuses to overwrite an existing repository. The workflow
builds release ESP32 and ESP32-S3 firmware, runs tests, and deploys only after
they pass. `npm run build` also creates `dist/source.zip` for review or transfer.

## Reconstruction and data formats

LED IDs are their zero-based position in the string. The wire protocol uses
a 300 ms green synchronization marker followed by 20 red/blue bits at
100 ms per bit: 12 index bits and an 8-bit CRC. LEDs remain lit throughout.
The decoder ignores transition frames and can combine incomplete cycles.
Prediction-based tracking ends ambiguous tracks at crossings. Identities are
backfilled only through the last verified codeword; a later crossing retains
the verified prefix and discards the uncertain tail. Consequently the last
couple of seconds of a scan may not contribute keyframes until another
identity cycle completes.

The geometry engine uses essential-matrix RANSAC, cheirality/parallax tests,
incremental PnP, multiview triangulation, and alternating robust bundle
adjustment. Without a supplied focal length it tries several camera models
and refines focal length and radial distortion. This is approximate
self-calibration; a known focal length is available as an advanced input.
Low parallax, pure rotation, disconnected views, and insufficient observations
are rejected or remain missing rather than assigned arbitrary depths.

Coordinates are centered and normalized; no absolute dimensions are needed.
String order is retained. Optional interpolation fills only short interior
gaps and marks those LEDs `estimated`. Wire length is not assumed to equal
the straight-line separation of neighbors. No unseen endpoint is extrapolated.

- **Capture JSON:** version, count, width, height, optional focal, frames
  containing time and `{id,x,y}` observations. No images or video are included.
- **Position JSON:** version, count, and ordered `leds`, each with id,
  position (three coordinates or null), status, views, and reprojection error.
- **Device map:** compact `{version:1,count,points,estimated}`; missing
  positions are null and remain dark during spatial effects.

## Validation limits

Automated tests cover numerical reconstruction, unknown focal length, noisy
and missing detections, outliers, zero-baseline rejection, image-to-ID-to-3D
reconstruction under simulated continuous movement and shake, CRC failures,
dropped frames, map validation, provisioning checksums, and firmware state
transitions/persistence with a fake strip.

Required physical checks remain: Android Chrome's HTTPS-to-local connection,
real optical ID decoding under camera auto-exposure/rolling shutter,
ESP32 strip timing under Wi-Fi load, USB flashing on each supported variant,
and reconstructed geometry on a real object. Numerical tests alone cannot
prove these. Start with 100 LEDs and compare repeat scans from different paths.

`firmware/tests/hardware-test.toit` is a separate on-device smoke test for a
classic ESP32 with 100 LEDs on GPIO 32. It exercises the real `pixel-strip`
driver, identification patterns, and all four effects with a synthetic map,
then turns the lights off. Review its pin/count before building it into a
test envelope. It does not configure Wi-Fi, save its synthetic map, or prove
optical correctness; it is not run as a host unit test.

Validation on 2026-10-14: Chrome UI tests passed in CI with Chrome
155.0.8059.79. The deployed app reconstructed all 80 simulated LEDs, and the
HTTPS-to-LAN HTTP check passed locally. The GPIO 32 smoke test completed on
an ESP32-D0WD-V3 with 4 MiB flash and the release SDK. Its slowest 100-LED
identification update was 14.3 ms, within the 100 ms symbol interval. Effects
also completed, but update rates and visible output still need evaluation
with the actual string; this is not evidence of real-camera reconstruction.
The generated live-video check also reconstructed all 30 LEDs with 0.11%
relative pairwise shape error locally. Its camera stream is synthetic; actual
exposure, rolling shutter, and optical reflections remain untested.

See [THIRD_PARTY.md](THIRD_PARTY.md) for dependency licenses.
