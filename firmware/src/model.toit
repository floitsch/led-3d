// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import math

MAX-LEDS ::= 1_024
SLOT-MS ::= 100
CYCLE-SLOTS ::= 23

checksum id/int -> int:
  crc := 0xa7
  [id >> 8, id & 255].do: | byte/int |
    crc ^= byte
    8.repeat:
      crc = ((crc << 1) ^ ((crc & 128) != 0 ? 7 : 0)) & 255
  return crc

validate-config value/any -> none:
  if value is not Map: throw "Expected strip configuration"
  count := value.get "count"
  pin := value.get "pin"
  order := value.get "order"
  if count is not int or not (1 <= count <= MAX-LEDS): throw "LED count must be 1–1024"
  if pin is not int or not (0 <= pin <= 48): throw "Invalid GPIO"
  if not ["GRB", "RGB", "BRG", "RBG", "GBR", "BGR"].contains order: throw "Invalid color order"

validate-map value/any count/int -> none:
  if value is not Map or (value.get "version") != 1 or (value.get "count") != count: throw "Map does not match the configured strip"
  points := value.get "points"
  if points is not List or points.size != count: throw "Invalid position count"
  points.do: | point |
    if not point: continue.do
    if point is not List or point.size != 3: throw "Invalid position"
    point.do: | v |
      if v is not num or not v.to-float.is-finite or v.abs > 10: throw "Invalid coordinate"
  estimated := value.get "estimated"
  if estimated is not List or estimated.size > count: throw "Invalid estimated indices"
  estimated.do: | id |
    if id is not int or not (0 <= id < count) or not points[id]: throw "Invalid estimated index"

validate-effect value/any -> none:
  if value is not Map: throw "Invalid effect"
  if not ["off", "fire", "rings", "swipe", "rainbow"].contains (value.get "name"): throw "Unknown effect"
  speed := value.get "speed"
  brightness := value.get "brightness"
  if speed is not num or not speed.to-float.is-finite or not (0.1 <= speed <= 3): throw "Invalid speed"
  if brightness is not num or not brightness.to-float.is-finite or not (0 <= brightness <= 1): throw "Invalid brightness"

clamp value/num -> float:
  return (max 0.0 (min 1.0 value)).to-float

effect-color name/string point/List time/num speed/num brightness/num -> List:
  t := time * speed
  x := point[0]
  y := point[1]
  z := point[2]
  color := [0.0, 0.0, 0.0]
  if name == "rings":
    phase := ((y - t * 0.6) % 2 + 2) % 2
    distance := (phase - 1) / 0.13
    glow := math.exp (0 - distance * distance)
    color = [0.1 * glow, 0.7 * glow, glow]
  else if name == "swipe":
    glow := max 0 (1 - (x - (math.sin t)).abs / 0.35)
    color = [glow, 0.25 * glow, 0.6 * glow]
  else if name == "fire":
    flicker := 0.5 + 0.25 * (math.sin (x * 13 + z * 9 + t * 5)) + 0.25 * (math.sin (z * 17 - x * 7 - t * 3))
    heat := clamp ((1 - y) * 0.55 + flicker * 0.5)
    color = [heat, (math.pow heat 3) * 0.6, (math.pow heat 8) * 0.1]
  else if name == "rainbow":
    color = [0.5 + 0.5 * (math.sin (t + x * 3)), 0.5 + 0.5 * (math.sin (t + y * 3 + 2.1)), 0.5 + 0.5 * (math.sin (t + z * 3 + 4.2))]
  return color.map: ((clamp it) * brightness * 255).round.to-int

/// Generates a self-synchronizing identity color, independent of network timing.
pattern-color id/int elapsed-ms/int brightness/int -> List:
  slot := (elapsed-ms / SLOT-MS) % CYCLE-SLOTS
  if slot < 3: return [8, brightness, 8]
  word := (id << 8) | (checksum id)
  bit := (word >> (19 - (slot - 3))) & 1
  return bit == 1 ? [brightness, 8, 8] : [8, 8, brightness]
