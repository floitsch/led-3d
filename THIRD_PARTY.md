# Third-party software

The application and reconstruction engine are MIT licensed (see LICENSE).

- `web/vendor/esptool.js`: Espressif **esptool-js 0.7.0**, Apache-2.0,
  https://github.com/espressif/esptool-js. Its browser bundle also includes
  pako (MIT/Zlib) and atob-lite (MIT). License texts are embedded at the top
  of the file. The wrapper exposes ESPLoader and Transport; upstream code is
  otherwise unchanged. Upstream npm integrity:
  `sha512-9wHuW/s9t4Vs6HKcr3pra3gbRVWwaN0eabMWodWH4KEJHEYZxgmWwZ3s0F4xcWVCZOc/L98bGZ4uWoZvR8KBKA==`.
- QR rendering currently loads **qrcode 1.5.4** (MIT) from esm.sh on demand:
  https://github.com/soldair/node-qrcode. If unavailable, the installation
  link remains available to copy. No credentials are sent to the QR service;
  QR generation runs locally in the browser.
- Firmware uses **Toit**, LGPL-2.1, with MIT-licensed SDK libraries:
  https://github.com/toitlang/toit. Release builds use
  `v2.0.0-alpha.199`; the firmware manifest records its exact SDK version.
  Corresponding VM source is available at that tag. The unmodified envelope
  comes from https://github.com/toitlang/envelopes.
- Firmware packages, pinned in `firmware/package.lock`, are MIT licensed:
  [pixel-strip](https://github.com/toitware/toit-pixel-strip),
  [mdns](https://github.com/close2/toit-mdns), and
  [http](https://github.com/toitlang/pkg-http).

Generated firmware is not checked into source control. The build publishes
the exact application source alongside the static site and retains SDK and
package versions so firmware can be rebuilt and modified.
