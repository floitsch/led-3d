// Copyright (C) 2026 Toit contributors.
// Preserve existing installation links and the ESP32's local landing-page link.
const params=new URLSearchParams(location.hash.slice(1));
if(params.has('device')||params.has('key'))location.replace(`capture.html${location.hash}`);
