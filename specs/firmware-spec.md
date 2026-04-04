# Firmware Specification
## ESP8266 Firmware Specification

---

## 1. Overview

Firmware controls:
- Relay switching
- Physical switch input (edge-triggered)
- MQTT communication
- Provisioning
- OTA updates
- IR control (AC)

## 2. Architecture

### 2.1 Main Loop
```cpp
loop() {
  handleWiFi();
  handleMQTT();
  handleSwitch();
  handleRelay();
  handleOTA();
}
```

## 3. State Machine

### States
- `BOOT`
- `PROVISIONING`
- `CONNECTING_WIFI`
- `CONNECTING_MQTT`
- `ACTIVE`
- `ERROR`

### Flow
```text
BOOT
→ Load EEPROM
→ If no Wi-Fi → PROVISIONING
→ Else CONNECTING_WIFI
→ CONNECTING_MQTT
→ ACTIVE
```

## 4. Provisioning

### 4.1 AP Mode
- SSID: `Device-XXXX`
- Web server endpoint: `POST /configure`

```json
{
  "ssid": "wifi",
  "password": "pass",
  "roomId": "room-101",
  "deviceId": "uuid"
}
```

### 4.2 Storage
EEPROM stores:
- Wi-Fi credentials
- `deviceId`
- `roomId`

## 5. MQTT Behavior

### 5.1 Connect
- Broker: `hub.local`
- Fallback: stored IP

### 5.2 Subscriptions
```text
home/{roomId}/{deviceId}/set
```

### 5.3 Publishing
- State
- Heartbeat (every 10s)
- Metadata (on connect)

## 6. Relay Control

### 6.1 Logic
```cpp
setRelay(state) {
  digitalWrite(RELAY_PIN, state);
}
```

## 7. Switch Handling

### 7.1 Edge Detection
- Interrupt-based
- Debounce: 50ms

### 7.2 Behavior
```cpp
onSwitchPress() {
  state = !state;
  setRelay(state);
  publishState();
}
```

## 8. State Sync

On reconnect:
- Publish current state
- Sync with hub

## 9. IR Control (AC)

### 9.1 Commands
- `ON`
- `OFF`

### 9.2 Flow
```cpp
onCommand("AC_ON") {
  sendIR(signal);
}
```

## 10. OTA

### 10.1 Trigger
- MQTT command

### 10.2 Flow
```text
Receive OTA trigger
→ Download firmware from hub
→ Flash
→ Reboot
```

## 11. Failure Handling

### 11.1 Wi-Fi Failure
- Retry loop
- Fallback to AP mode

### 11.2 MQTT Failure
- Reconnect loop

### 11.3 Power Loss
- Restore last state from EEPROM

## 12. Heartbeat

Every 10 seconds:

```json
{
  "deviceId": "string",
  "status": "ONLINE"
}
```

## 13. Performance Constraints
- Minimal RAM usage
- Non-blocking loop
- Watchdog enabled

## 14. Security (MVP)
- No encryption (local network)
- Future: TLS

## 15. Constants
```cpp
#define HEARTBEAT_INTERVAL 10000
#define DEBOUNCE_DELAY 50
```

## 16. Summary
Firmware is:
- Event-driven
- Stateless executor
- Resilient to failures
- Fully aligned with `contracts.md`
