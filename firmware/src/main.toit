// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import encoding.json
import http
import monitor
import net.wifi as wifi
import mdns.client show LocalMdnsClient
import pixel_strip show PixelStrip
import system.firmware as firmware
import system.storage as storage
import .model as model

SITE ::= "https://floitsch.github.io/led-3d/"
ORIGIN ::= "https://floitsch.github.io"

class Controller:
  mutex ::= monitor.Mutex
  bucket_ := null
  strip-factory_/Lambda? := null
  config := {"pin": 18, "count": 100, "order": "GRB"}
  map := null
  effect := {"name": "off", "speed": 1.0, "brightness": 0.3}
  strip_/PixelStrip? := null
  bytes_/ByteArray? := null
  mode := "off"
  last-error/string? := null
  scan-start_ := 0
  scan-brightness_ := 80
  scan-deadline_ := 0
  test-index_ := 0
  test-color_ := [50, 0, 0]
  test-deadline_ := 0

  constructor --store/any=null --strip-factory/Lambda?=null:
    bucket_ = store or (storage.Bucket.open --flash "floitsch.github.io/led-3d")
    strip-factory_ = strip-factory
    config = bucket_.get "config" --if-absent=: config
    model.validate-config config
    map = bucket_.get "map"
    if map: model.validate-map map config["count"]
    effect = bucket_.get "effect" --if-absent=: effect
    model.validate-effect effect
    // A fresh device never drives a GPIO before the user configures it.
    if bucket_.get "config":
      error := catch: open-strip_
      if error: last-error = "$error"
      else if map: mode = "effect"

  open-strip_ -> none:
    strip_ = strip-factory_
        ? strip-factory_.call config["count"] config["pin"]
        : PixelStrip.rmt config["count"] --pin=config["pin"]
    bytes_ = ByteArray (config["count"] * 3)
    last-error = null

  configure value/any -> none:
    model.validate-config value
    previous := config
    if strip_:
      bytes_.fill 0
      strip_.output-interleaved bytes_
      strip_.close
      strip_ = null
    config = {"pin": value["pin"], "count": value["count"], "order": value["order"]}
    mode = "off"
    error := catch: open-strip_
    if error:
      config = previous
      last-error = "GPIO could not be opened: $error"
      throw last-error
    if previous["count"] != config["count"]:
      map = null
      bucket_["map"] = null
    bucket_["config"] = config

  command path/string value/any now/int -> any:
    if path == "/api/config":
      configure value
    else if path == "/api/map":
      model.validate-map value config["count"]
      bucket_["map"] = value
      map = value
    else if path == "/api/effect":
      model.validate-effect value
      if not strip_: throw "Configure the LED pin first"
      if not map and value["name"] != "off": throw "Save LED positions first"
      bucket_["effect"] = value
      effect = value
      mode = "effect"
    else if path == "/api/scan":
      if not strip_: throw "Configure the LED pin first"
      brightness := value.get "brightness"
      if brightness is not int or not (25 <= brightness <= 180): throw "Invalid scan brightness"
      scan-brightness_ = brightness
      scan-start_ = now
      scan-deadline_ = now + 120_000
      mode = "scan"
    else if path == "/api/stop":
      mode = "off"
    else if path == "/api/test":
      if not strip_: throw "Configure the LED pin first"
      index := value.get "index"
      color := value.get "color"
      if index is not int or not (0 <= index < config["count"]): throw "Increase the configured count to test this LED"
      if not ["red", "green", "blue"].contains color: throw "Invalid test color"
      test-index_ = index
      test-color_ = color == "red" ? [60, 0, 0] : color == "green" ? [0, 60, 0] : [0, 0, 60]
      test-deadline_ = now + 30_000
      mode = "test"
    else:
      throw "Unknown command"
    return {"ok": true}

  tick now/int -> none:
    if not strip_: return
    if mode == "scan" and now >= scan-deadline_: mode = "off"
    if mode == "test" and now >= test-deadline_: mode = "off"
    order/string := config["order"]
    channels := List 3: order[it] == 'R' ? 0 : order[it] == 'G' ? 1 : 2
    config["count"].repeat: | id/int |
      color := [0, 0, 0]
      if mode == "scan":
        color = model.pattern-color id (now - scan-start_) scan-brightness_
      else if mode == "test" and id == test-index_:
        color = test-color_
      else if mode == "effect" and map and map["points"][id]:
        color = model.effect-color effect["name"] map["points"][id] (now / 1000.0) effect["speed"] effect["brightness"]
      3.repeat: | c/int | bytes_[id * 3 + c] = color[channels[c]]
    strip_.output-interleaved bytes_

  next-delay now/int -> int:
    // Align scan updates to symbol boundaries instead of accumulating output time.
    if mode == "scan": return model.SLOT-MS - ((now - scan-start_) % model.SLOT-MS)
    return 25

main:
  settings := firmware.config["led-3d"] or {:}
  hostname := settings.get "hostname" --if-absent=: "led-tree"
  key := settings.get "key" --if-absent=: ""
  if key.size < 32: throw "Install with the LED 3D installer to configure Wi-Fi and pairing"
  controller := Controller
  task::
    while true:
      start := Time.monotonic-us / 1000
      delay := 25
      error := catch:
        controller.mutex.do:
          controller.tick start
          delay = controller.next-delay start
      if error:
        controller.mode = "off"
        controller.last-error = "$error"
      sleep --ms=(max 1 (delay - ((Time.monotonic-us / 1000) - start)))
  // Reconnect Wi-Fi and restart discovery/listening after a network failure.
  while true:
    error := catch:
      network := wifi.open null
      mdns := LocalMdnsClient --hostname="$(hostname).local"
      try:
        socket := network.tcp-listen 80
        mdns.register-service "_http._tcp" 80 --name="LED 3D" --txt={"path": "/", "version": "1"}
        server := http.Server --max-tasks=3
        server.listen socket:: | request/http.RequestIncoming writer/http.ResponseWriter |
          serve request writer controller key mdns.hostname
      finally:
        mdns.close
        network.close
    if error: print "Network service restarting: $error"
    sleep --ms=3_000

serve request/http.RequestIncoming writer/http.ResponseWriter controller/Controller key/string hostname/string -> none:
  try:
    path := request.query.resource
    origin := request.headers.single "Origin"
    writer.headers.set "Cache-Control" "no-store"
    if origin == ORIGIN:
      writer.headers.set "Access-Control-Allow-Origin" ORIGIN
      writer.headers.set "Vary" "Origin"
      writer.headers.set "Access-Control-Allow-Methods" "GET, POST, OPTIONS"
      writer.headers.set "Access-Control-Allow-Headers" "Content-Type, X-LED-Key"
    if request.method == "OPTIONS":
      writer.write-headers (origin == ORIGIN ? 204 : 403)
      return
    if path == "/" and request.method == "GET":
      writer.headers.set "Content-Type" "text/html; charset=utf-8"
      writer.out.write """
        <!doctype html><meta name="viewport" content="width=device-width"><title>LED 3D</title>
        <body style="font:18px system-ui;background:#101720;color:#edf3f8;padding:3em">
        <h1>LED 3D</h1><p>Your controller is online.</p>
        <a style="color:#b6f36d" href="$(SITE)#device=$hostname">Open LED 3D</a>
        <p>Use your installation link to supply the pairing key.</p></body>
        """
      return
    writer.headers.set "Content-Type" "application/json"
    if origin and origin != ORIGIN:
      writer.write-headers 403
      writer.out.write "{\"error\":\"Origin not allowed\"}"
      return
    if (request.headers.single "X-LED-Key") != key:
      writer.write-headers 401
      writer.out.write "{\"error\":\"Pairing key required. Use the installation link.\"}"
      return
    response := null
    error := catch:
      if request.method == "GET" and path == "/api/status":
        response = {"version": 1, "hostname": hostname, "config": controller.config, "mode": controller.mode, "hasMap": controller.map != null, "error": controller.last-error}
      else if request.method == "GET" and path == "/api/map":
        response = controller.map
      else if request.method == "POST":
        // Limit allocation before parsing a browser-supplied JSON body.
        bytes := ByteArray 0
        while data := request.body.read:
          if bytes.size + data.size > 98_304: throw "Request too large"
          bytes += data
        value := json.decode bytes
        if value is not Map: throw "Expected a JSON object"
        controller.mutex.do:
          response = controller.command path value (Time.monotonic-us / 1000)
      else:
        throw "Unknown endpoint"
    if error:
      writer.write-headers 400
      response = {"error": "$error"}
    writer.out.write (json.encode response)
  finally:
    writer.close
