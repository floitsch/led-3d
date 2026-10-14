// Copyright (C) 2026 Toit contributors.
import expect show *
import pixel_strip show PixelStrip
import ..src.main show Controller

class FakeStrip extends PixelStrip:
  last := #[]
  closed := false

  constructor count/int:
    super count

  output-interleaved data/ByteArray -> none:
    if closed: throw "Writing to a closed strip"
    last = data.copy

  close -> none:
    closed = true

  is-closed -> bool:
    return closed

main:
  store := {:}
  strip := FakeStrip 3
  factory := :: | count/int pin/int | strip = FakeStrip count; strip
  controller := Controller --store=store --strip-factory=factory
  expect-equals "off" controller.mode
  controller.command "/api/config" {"pin": 18, "count": 3, "order": "GRB"} 0
  controller.command "/api/test" {"index": 1, "color": "red"} 0
  controller.tick 100
  expect-equals #[0, 0, 0, 0, 60, 0, 0, 0, 0] strip.last
  controller.tick 30_001
  expect-equals #[0, 0, 0, 0, 0, 0, 0, 0, 0] strip.last
  controller.command "/api/scan" {"brightness": 80} 1_000
  controller.tick 1_050
  expect-equals #[80, 8, 8, 80, 8, 8, 80, 8, 8] strip.last
  controller.tick 121_001
  expect-equals "off" controller.mode
  map := {"version": 1, "count": 3, "points": [[0, 0, 0], null, [0, 1, 0]], "estimated": [2]}
  controller.command "/api/map" map 0
  controller.command "/api/effect" {"name": "fire", "speed": 1, "brightness": 0.2} 0
  controller.tick 1_000
  expect-equals #[0, 0, 0] strip.last[3..6]
  rebooted := Controller --store=store --strip-factory=factory
  expect-equals "effect" rebooted.mode
  expect-equals map rebooted.map
  rebooted.command "/api/config" {"pin": 18, "count": 4, "order": "RGB"} 0
  expect-equals null rebooted.map
  expect-equals null (store.get "map")
  expect (catch: rebooted.command "/api/effect" {"name": "fire", "speed": 1, "brightness": 0.3} 0) != null
  print "Firmware controller tests passed"
