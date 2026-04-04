# Zapp - Implementation Plan

## 1. Overview
This document defines the production-ready technical implementation plan for a modular, local-first smart switch system.

Goals:
- Deterministic local control (no cloud dependency)
- Modular, repairable hardware
- Scalable deployment across properties
- PMS-integrated automation (hospitality use case)
- MCP-ready programmable infrastructure

## 2. System Architecture

### 2.1 Property-Level Architecture
```text
[ESP Nodes (<=10)]
        ↓ Wi-Fi
      [Router]
        ↓ Ethernet
[Raspberry Pi Hub]
        ↓
[Optional Cloud Sync]
```

### 2.2 Core Components
#### Device Layer
- ESP8266 (logic)
- Relay module (mechanical relays)
- IR module (AC control)

#### Hub Layer (Raspberry Pi)
- MQTT broker (Mosquitto)
- Backend (Node.js)
- SQLite database
- Scheduler

#### Client Layer
- Web dashboard (PWA)
- Mobile browser (same PWA)

#### Cloud Layer (Optional)
- Multi-property aggregation
- Monitoring
- OTA distribution

## 3. Repository Structure
```text
/firmware
  /core
  /modules
  /drivers
  main.ino

/hub
  /src
    /core
      mqtt
      state
      scheduler
      registry
    /api
      rest
      websocket
    /mcp
    /utils
  /db
  /config

/dashboard
  /app
  /components
  /lib

/cloud (future)
/infra
```

## 4. Firmware Implementation

### 4.1 Architecture
```text
main loop
 ├── wifi manager
 ├── mqtt client
 ├── relay controller
 ├── switch interrupt handler
 ├── state manager
 └── ota handler
```

### 4.2 Core Features
#### 1) Edge-Triggered Switch
- Interrupt-based detection
- Software debouncing

#### 2) Local Toggle Logic
```text
onSwitchPress():
  state = !state
  setRelay(state)
  publishState()
```

#### 3) MQTT Topics
```text
home/{property}/{room}/{device}/set
home/{property}/{room}/{device}/state
home/{property}/{device}/heartbeat
```

#### 4) Provisioning Mode
AP mode flow:
```text
Boot → No Wi-Fi → Start AP
→ Mobile connects
→ Send Wi-Fi + Hub IP
→ Save to EEPROM
→ Reboot
```

#### 5) Hub Discovery
- Attempt mDNS lookup (`hub.local`)
- Fallback to stored IP

#### 6) OTA
- Endpoint: hub-hosted firmware
- Trigger: MQTT command

#### 7) Fallback Behavior
- Works without MQTT
- Stores last known state
- Switch always functional

## 5. Hub Implementation (Raspberry Pi)

### 5.1 Tech Stack
- Runtime: Node.js (TypeScript)
- Framework: Fastify
- MQTT: Mosquitto + `mqtt.js`
- Database: `better-sqlite3`

### 5.2 Module Breakdown
```text
/core
  mqtt-gateway
  state-manager
  scheduler
  device-registry
/api
  rest
  websocket (future)
/mcp
  tool-server
```

### 5.3 MQTT Gateway
Responsibilities:
- Subscribe to all device topics
- Route messages to internal services

### 5.4 State Manager
- Source of truth
- Maintains device states and room states

Schema:
```sql
devices(id, room_id, type, status)
states(device_id, state, updated_at)
rooms(id, property_id)
```

### 5.5 Scheduler
- Executes time-based automations
- Executes PMS-triggered automations

### 5.6 Device Registry
- Handles device onboarding
- Handles metadata mapping

## 6. API Layer

### 6.1 REST API
```http
GET  /devices
POST /devices/:id/action
GET  /rooms/:id
POST /guest/checkin
```

### 6.2 PMS Integration
Flow:
```text
POST /guest/checkin
→ map room
→ trigger automation
→ publish MQTT commands
```

### 6.3 Example Payload
```json
{
  "guestId": "G1",
  "roomId": "R101"
}
```

## 7. Dashboard (PWA)

### 7.1 Stack
- Next.js
- React
- Zustand

### 7.2 Features
- Device control
- Room grouping
- Status indicators

### 7.3 Data Flow
```text
UI → REST API → Hub
→ MQTT → Device
→ MQTT → Hub → UI refresh
```

## 8. MCP (LLM Integration)

### 8.1 Implementation
- Expose tool endpoints via HTTP

Example:
```json
{
  "name": "set_device_state",
  "params": {
    "deviceId": "string",
    "state": "on/off"
  }
}
```

### 8.2 Capabilities
- Query state
- Trigger actions
- Create automations

## 9. AC Control (IR)

### 9.1 Implementation
- IR LED module
- Pre-recorded signals

### 9.2 Flow
```text
Hub → MQTT → ESP
→ IR signal sent
→ AC responds
```

## 10. Device Provisioning (At Scale)

### 10.1 Flow
```text
Device boots
→ AP mode
→ Mobile connects
→ Assign room + Wi-Fi
→ Reboot
→ Auto-register
```

### 10.2 Scaling Strategy
- QR code per device
- Batch assignment tool

## 11. Networking Constraints
- Max ~10 devices per hub
- Use a strong router
- Use static DHCP reservations

## 12. Reliability and Fault Handling

### 12.1 Device
- Local toggle always works
- EEPROM state persistence

### 12.2 Hub
- Restart-safe (`systemd`)
- Database persistence

### 12.3 Failure Modes
| Failure | Handling |
| --- | --- |
| Wi-Fi drop | Reconnect loop |
| MQTT down | Local fallback |
| Hub down | Device still works |

## 13. Deployment

### 13.1 Raspberry Pi Setup
Install:
- Node.js
- Mosquitto
- SQLite

### 13.2 Service
- `systemd` service
- Auto-start on boot
- Restart on failure

### 13.3 Access
```text
http://<pi-ip>:3000
```

## 14. OTA Strategy
- Hub hosts firmware
- Devices pull updates

## 15. Security
- MQTT authentication
- API tokens
- LAN isolation

## 16. Milestones

### Phase 1 (Weeks 1-3)
- Firmware core
- MQTT communication
- Basic hub

### Phase 2 (Weeks 4-6)
- Dashboard
- PMS integration
- Provisioning

### Phase 3 (Weeks 7-9)
- MCP layer
- OTA updates
- Stability hardening

## 17. Production Readiness Checklist
- [ ] Device provisioning stable
- [ ] MQTT reliability tested
- [ ] Hub crash recovery verified
- [ ] OTA tested
- [ ] Electrical safety validated

## 18. Future Enhancements
- WebSockets (real-time UI)
- Cloud dashboard
- Energy analytics
- Sensor integration

## 19. Summary
This implementation provides:
- Deterministic local control
- Modular hardware system
- Scalable deployment model
- Extensible API + MCP interface

It forms a foundation layer for programmable physical infrastructure.
# Implementation Plan
## Local-First Modular Smart Switch System

## 1. Overview
This document defines the production-ready technical implementation plan for a modular, local-first smart switch system.

Goals:
- Deterministic local control (no cloud dependency)
- Modular, repairable hardware
- Scalable deployment across properties
- PMS-integrated automation (hospitality use case)
- MCP-ready programmable infrastructure

## 2. System Architecture
It forms a foundation layer for programmable physical infrastructure.
* Works without MQTT
* Stores last known state
* Switch always functional

---

# 5. Hub Implementation (Raspberry Pi)

## 5.1 Tech Stack

* Runtime: Node.js (TypeScript)
* Framework: Fastify
* MQTT: mosquitto + mqtt.js
* DB: better-sqlite3

---

## 5.2 Module Breakdown

```id="hub-modules"
/core
  mqtt-gateway
  state-manager
  scheduler
  device-registry
/api
  rest
  websocket (future)
/mcp
  tool-server
```

---

## 5.3 MQTT Gateway

Responsibilities:

* Subscribe to all device topics
* Route messages to services

---

## 5.4 State Manager

* Source of truth
* Maintains:

  * device states
  * room states

### Schema

```sql id="db-schema"
devices(id, room_id, type, status)
states(device_id, state, updated_at)
rooms(id, property_id)
```

---

## 5.5 Scheduler

* Executes:

  * time-based automations
  * PMS-triggered automations

---

## 5.6 Device Registry

* Handles:

  * device onboarding
  * metadata mapping

---

# 6. API Layer

## 6.1 REST API

```http id="api"
GET  /devices
POST /devices/:id/action
GET  /rooms/:id
POST /guest/checkin
```

---

## 6.2 PMS Integration

### Flow

```id="pms-flow"
POST /guest/checkin
→ map room
→ trigger automation
→ publish MQTT commands
```

---

## 6.3 Example

```json id="pms-example"
{
  "guestId": "G1",
  "roomId": "R101"
}
```

---

# 7. Dashboard (PWA)

## 7.1 Stack

* Next.js
* React
* Zustand

---

## 7.2 Features

* Device control
* Room grouping
* Status indicators

---

## 7.3 Data Flow

```id="dashboard-flow"
UI → REST API → Hub
→ MQTT → Device
→ MQTT → Hub → UI refresh
```

---

# 8. MCP (LLM Integration)

## 8.1 Implementation

* Expose tool endpoints via HTTP

### Example

```json id="mcp-tool"
{
  "name": "set_device_state",
  "params": {
    "deviceId": "string",
    "state": "on/off"
  }
}
```

---

## 8.2 Capabilities

* Query state
* Trigger actions
* Create automations

---

# 9. AC Control (IR)

## 9.1 Implementation

* IR LED module
* Pre-recorded signals

---

## 9.2 Flow

```id="ir-flow"
Hub → MQTT → ESP
→ IR signal sent
→ AC responds
```

---

# 10. Device Provisioning (At Scale)

## 10.1 Flow

```id="provisioning"
Device boots
→ AP mode
→ Mobile connects
→ Assign room + WiFi
→ Reboot
→ Auto-register
```

---

## 10.2 Scaling Strategy

* QR code per device
* Batch assignment tool

---

# 11. Networking Constraints

* Max ~10 devices per hub
* Use:

  * strong router
  * static DHCP

---

# 12. Reliability & Fault Handling

## 12.1 Device

* Local toggle always works
* EEPROM state persistence

---

## 12.2 Hub

* Restart-safe (systemd)
* DB persistence

---

## 12.3 Failure Modes

| Failure   | Handling           |
| --------- | ------------------ |
| WiFi drop | reconnect loop     |
| MQTT down | local fallback     |
| Hub down  | device still works |

---

# 13. Deployment

## 13.1 Raspberry Pi Setup

* Install:

  * Node
  * Mosquitto
  * SQLite

---

## 13.2 Service

* systemd service:

  * auto start
  * restart on failure

---

## 13.3 Access

```
http://<pi-ip>:3000
```

---

# 14. OTA Strategy

* Hub hosts firmware
* Devices pull updates

---

# 15. Security

* MQTT auth
* API tokens
* LAN isolation

---

# 16. Milestones

## Phase 1 (Weeks 1–3)

* Firmware core
* MQTT communication
* Basic hub

## Phase 2 (Weeks 4–6)

* Dashboard
* PMS integration
* Provisioning

## Phase 3 (Weeks 7–9)

* MCP layer
* OTA updates
* Stability

---

# 17. Production Readiness Checklist

* [ ] Device provisioning stable
* [ ] MQTT reliability tested
* [ ] Hub crash recovery verified
* [ ] OTA tested
* [ ] Electrical safety validated

---

# 18. Future Enhancements

* WebSockets (real-time UI)
* Cloud dashboard
* Energy analytics
* Sensor integration

---

# 19. Summary

This implementation provides:

* Deterministic local control
* Modular hardware system
* Scalable deployment model
* Extensible API + MCP interface

It forms a **foundation layer for programmable physical infrastructure**.

---
