// Copyright (C) 2026 Toit contributors.
import expect show *
import ..src.model as model

main:
  model.validate-config {"pin": 18, "count": 100, "order": "GRB"}
  expect (catch: model.validate-config {"pin": 18, "count": 0, "order": "GRB"}) != null
  expect (catch: model.validate-map {"version": 1, "count": 1, "points": [[0, 0, 11]], "estimated": []} 1) != null
  model.validate-map {"version": 1, "count": 2, "points": [[0, 0, 0], null], "estimated": []} 2
  expect-equals [8, 80, 8] (model.pattern-color 0 0 80)
  // Shared browser/firmware protocol fixtures, including the top supported index.
  expect-equals [115, 116, 93, 191] ([0, 1, 99, 1023].map: model.checksum it)
  expect-equals [26, 179, 255] (model.effect-color "rings" [0, -0.4, 0] 1 1 1)
  1_024.repeat: | id/int |
    word := 0
    20.repeat: | bit/int |
      color := model.pattern-color id ((bit + 3) * 100 + 50) 80
      word = (word << 1) | (color[0] == 80 ? 1 : 0)
    expect-equals id (word >> 8)
    expect-equals (model.checksum id) (word & 255)
  ["off", "fire", "rings", "swipe", "rainbow"].do: | name/string |
    color := model.effect-color name [0.2, -0.4, 0.3] 3.5 1.0 0.3
    color.do: expect (0 <= it <= 77)
  print "Firmware model tests passed"
