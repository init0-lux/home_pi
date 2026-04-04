# ESP8266 Firmware

This firmware implements the Zapp local-first switch node described in [README.md](/home/init0/zapp/worktrees/firmware/README.md), [PRD.md](/home/init0/zapp/worktrees/firmware/PRD.md), [contracts.md](/home/init0/zapp/worktrees/firmware/contracts/contracts.md), and [firmware-spec.md](/home/init0/zapp/worktrees/firmware/specs/firmware-spec.md).

## Product Context Encoded Here
- One ESP8266 board exposes four relay/button channels from the README pin map.
- Each relay channel is published as its own logical device so the hub can stay aligned with the contract shape: `home/{roomId}/{deviceId}/...`.
- The hub remains authoritative when connected, but physical switches still work offline using persisted last-known relay state.
- Provisioning is local-only: first boot starts an AP and accepts `POST /configure`.

## MQTT Model
- Primary subscribe topics:
  - `home/{roomId}/{baseDeviceId}/set`
  - `home/{roomId}/{baseDeviceId}-ch{1-4}/set`
- Primary publish topics:
  - `home/{roomId}/{baseDeviceId}-ch{1-4}/state`
  - `home/{baseDeviceId}-ch{1-4}/heartbeat`
  - `home/{baseDeviceId}-ch{1-4}/meta`
- Legacy compatibility:
  - `home/appliance/{1-4}/set`

## Provisioning Payload
```json
{
  "ssid": "wifi-name",
  "password": "wifi-password",
  "roomId": "room-101",
  "deviceId": "a3f1c2e4-9b12-4f6a-8c1d-92ab3e1f7c21",
  "hubIp": "192.168.1.10",
  "propertyId": "property-01"
}
```

## Libraries
- `ESP8266WiFi`
- `ESP8266WebServer`
- `PubSubClient`
- `EEPROM`
- `ArduinoJson` v6+
- `ESP8266httpUpdate`
- `ESP8266mDNS`

## Notes
- OTA is triggered by including `otaUrl` in a node or channel command payload.
- `irCommand` accepts `AC_ON` and `AC_OFF`; the current module is a stub hook for future IR hardware integration.
- PubSubClient is used for compatibility with the repo docs; if strict MQTT QoS 1 publish semantics are required, the MQTT client layer should be upgraded.

## Build / Flash
With `arduino-cli`:

```bash
cd firmware
arduino-cli lib install ArduinoJson PubSubClient
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 firmware
arduino-cli board list
arduino-cli upload -p /dev/ttyUSB0 --fqbn esp8266:esp8266:nodemcuv2 firmware
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

With PlatformIO:

```bash
cd firmware
pio run
pio run -t upload --upload-port /dev/ttyUSB0
pio device monitor --baud 115200
```

If your board is not a NodeMCU-style ESP8266, update `board` in `platformio.ini` before flashing.
