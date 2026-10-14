// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.

// Run only on an ESP32 wired for this pin and LED count. This test drives GPIO.
// The map is synthetic and remains in memory; it is not a recovered LED map.
import expect show *
import ..src.main show Controller

PIN ::= 32
COUNT ::= 100

main:
  controller := Controller --store={:}
  controller.command "/api/config" {"pin": PIN, "count": COUNT, "order": "GRB"} 0
  try:
    ["red", "green", "blue"].do: | color/string |
      print "First LED: $color"
      controller.command "/api/test" {"index": 0, "color": color} 0
      controller.tick 0
      sleep --ms=700
    print "Last LED: red"
    controller.command "/api/test" {"index": COUNT - 1, "color": "red"} 0
    controller.tick 0
    sleep --ms=700

    print "Identification pattern: two complete cycles"
    controller.command "/api/scan" {"brightness": 40} 0
    slowest := 0
    46.repeat: | slot/int |
      start := Time.monotonic-us
      controller.tick (slot * 100)
      elapsed := Time.monotonic-us - start
      slowest = max slowest elapsed
      sleep --ms=(max 1 ((100_000 - elapsed) / 1000))
    print "Slowest 100-LED update: $slowest us"
    expect slowest < 100_000

    points := List COUNT: | i/int | [0.0, i.to-float / (COUNT - 1) - 0.5, 0.0]
    controller.command "/api/map" {"version": 1, "count": COUNT, "points": points, "estimated": []} 0
    ["fire", "rings", "swipe", "rainbow"].do: | effect/string |
      print "Effect: $effect (synthetic vertical line)"
      controller.command "/api/effect" {"name": effect, "speed": 1, "brightness": 0.15} 0
      effect-start := Time.monotonic-us
      80.repeat: | frame/int |
        controller.tick (frame * 25)
        sleep --ms=25
      print "Completed $effect in $((Time.monotonic-us - effect-start) / 1000) ms"
    print "Hardware controller smoke test passed; optical output needs visual confirmation"
  finally:
    controller.command "/api/stop" {:} 0
    controller.tick 0
