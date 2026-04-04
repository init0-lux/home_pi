# Product Requirements Document - Zapp
## Local-First Modular Smart Switch System


## 1. Overview

### 1.1 Product Vision
Build a **modular, local-first smart switch system** that:
- Competes with Tuya-class smart switch ecosystems
- Works **without cloud dependency**
- Integrates into **existing switchboards**
- Enables **hospitality automation (Zostel use case)**

Positioning:
> Self-hosted smart infrastructure for physical spaces

### 1.2 Core Value Propositions
- Local-first reliability (works without internet)
- Modular hardware (repairable, swappable components)
- Seamless retrofit into existing switchboards
- Dual control: physical switches + app + API + LLM
- Enterprise-ready (multi-property management)

## 2. Target Users

### Primary
- Hostel chains (e.g., Zostel)
- Hotels / co-living spaces

### Secondary
- Privacy-focused homeowners
- Smart home enthusiasts (self-hosted)

## 3. System Architecture

### 3.1 High-Level Architecture

```text
[ Physical Switch ]
        ↓
[ Relay Module ] ←→ [ ESP8266 Logic Module ]
        ↓
    Appliance

ESP → MQTT → Local Hub (Raspberry Pi)
             ↓
      State + Scheduler
             ↓
    Cloud Sync (Optional)
             ↓
   Apps / Dashboard / MCP
```

### 3.2 Core Layers

#### 1) Device Layer
- ESP8266 logic module
- Relay module (10A)
- Edge-triggered switch input

#### 2) Local Hub
- MQTT broker (Mosquitto)
- Node.js backend
- SQLite DB
- Scheduler engine

#### 3) Cloud Layer (Optional)
- Multi-tenant SaaS
- Remote monitoring
- Analytics + OTA

#### 4) Control Layer
- REST API
- WebSocket
- MCP server (LLM control)

## 4. Hardware Design

### 4.1 Modular Hardware Architecture

#### Components

##### A. Logic Module
- ESP8266
- Power regulation (AC → 3.3V)
- Wi-Fi + OTA
- EEPROM

##### B. Relay Module
- 10A relays (lights/fans)
- Optocouplers
- Replaceable fuse

##### C. Interconnect
Standardized pin interface:

```text
VCC | GND | GPIO1 | GPIO2 | GPIO3 | GPIO4
```

### 4.2 Modularity Philosophy
Inspired by modular systems:
- Separate **logic** and **power**
- Failure isolation:
  - Relay burns → replace relay module
  - ESP crashes → replace logic module

Field replacement flow:
1. Remove faceplate
2. Unplug faulty module
3. Insert replacement
4. Auto-reconnect to system

### 4.3 Electrical Safety
- Surge protection (MOV + TVS)
- Brownout detection
- Fuse per channel
- Isolation (opto + spacing)
- Flame-retardant PCB

### 4.4 Installation Model
- Installed behind switchboard (neutral available)
- No rewiring required beyond:
  - Live input
  - Neutral
  - Load output

## 5. Physical Switch Behavior

### 5.1 Edge-Triggered Toggle System
Switch acts as a:
> Stateless toggle input

Behavior:

| Action | Result |
| --- | --- |
| App turns ON | Light ON |
| Switch toggle | Light OFF |
| Switch toggle again | Light ON |

### 5.2 State Management Model

Source of truth:
- Local hub (not device)

Flow:

```text
Switch Press → Device publishes toggle event
→ Hub updates state
→ Hub broadcasts new state
→ Device applies state
```

### 5.3 Conflict Resolution

| Scenario | Resolution |
| --- | --- |
| App + Switch simultaneous | Last-write-wins |
| Device offline | Local fallback |
| Reconnect | Full state sync |

## 6. Networking & Discovery

### 6.1 Protocols
- MQTT → primary communication
- mDNS → discovery
- HTTP → API layer

### 6.2 Device Discovery
Flow:
1. Device boots
2. Connects to Wi-Fi
3. Publishes:

```json
{
  "deviceId": "abc123",
  "type": "relay",
  "room": "room101"
}
```

4. Hub auto-registers device

### 6.3 Topic Structure

```text
home/{property}/{room}/{device}/set
home/{property}/{room}/{device}/state
home/{property}/node/status
```

## 7. Zostel Use Case (V1)

### 7.1 PMS Integration Flow

```text
Guest Check-in
→ POST /guest/checkin
→ Map guest → room → devices
→ Trigger automation
```

### 7.2 Automation Flow

```text
Guest checks in
→ Room assigned
→ Guest near location (geofence)
→ Trigger:
   - Lights ON
   - Fan ON / AC ON
```

### 7.3 Example API

```http
POST /guest/checkin
Content-Type: application/json

{
  "guestId": "G123",
  "roomId": "R101",
  "checkinTime": 1712000000
}
```

## 8. Local vs Cloud Architecture

### 8.1 Local Hub (Primary)
Handles:
- State
- Scheduling
- Automation
- Device control

### 8.2 Cloud Layer (Secondary)
Syncs:
- Device state
- Logs
- Metrics

### 8.3 Offline Guarantees
- All automations run locally
- Devices operate without internet
- Cloud failure = no impact

## 9. API + MCP (LLM Integration)

### 9.1 REST API

```http
GET  /devices
POST /devices/:id/action
GET  /rooms/:id/state
```

### 9.2 MCP Server
System exposes:
- Device schema
- Capabilities
- Action endpoints

Example tool:

```json
{
  "name": "toggle_light",
  "parameters": {
    "room": "string",
    "state": "on/off"
  }
}
```

### 9.3 LLM Interaction Model
Any LLM can:
- Query state
- Execute actions
- Create automations

## 10. Device Provisioning

### 10.1 First Boot Flow
1. Device creates hotspot
2. User connects
3. Inputs:
   - Wi-Fi credentials
   - Hub IP
   - Room mapping

### 10.2 Auto Registration
- Device publishes identity
- Hub assigns metadata
- Appears in dashboard

### 10.3 At Scale (400+ Nodes)
- Batch provisioning tool
- QR-based device mapping
- Remote health monitoring

## 11. Reliability & Fault Handling

### 11.1 Power Issues

| Issue | Handling |
| --- | --- |
| Surge | MOV clamps |
| Brownout | Auto reset |
| Spike | Fuse trips |

### 11.2 Device Failures

| Failure | Action |
| --- | --- |
| Relay burnout | Replace relay module |
| ESP failure | Replace logic module |
| Wi-Fi drop | Reconnect loop |

### 11.3 Fallback Behavior
- Physical switches always work
- Device stores last state locally
- Hub resyncs on reconnect

## 12. Dashboard & UX

### 12.1 Features
- Real-time state
- Room grouping
- Device health indicators
- Manual override

### 12.2 Control Modes
- Physical switch
- Web dashboard
- Mobile app
- LLM / MCP

## 13. Security
- MQTT auth
- Token-based API
- LAN isolation
- Optional cloud encryption

## 14. Scalability

### Target
- 400+ devices
- 100 properties

### Strategy
- Per-property hub
- Cloud aggregation layer
- Horizontal backend scaling

## 15. Roadmap

### Phase 1 (MVP)
- Relay control
- MQTT + hub
- Dashboard
- Zostel check-in automation

### Phase 2
- Device provisioning
- Modular hardware v1
- Cloud sync

### Phase 3
- MCP + LLM integration
- OTA updates
- Scenes

### Phase 4
- Sensors
- Energy analytics
- Advanced automation

## 16. Competitive Positioning

| Feature | This Product | Tuya |
| --- | --- | --- |
| Local-first | Yes | No |
| Modular hardware | Yes | No |
| Open API | Yes | Limited |
| LLM control | Yes | No |
| Cloud dependency | Optional | Required |

## 17. Risks
- Hardware reliability in Indian power conditions
- Wi-Fi congestion in dense hostels
- PMS integration variability
- Installation complexity

## 18. Success Metrics
- Deployment success rate
- Device uptime (>99%)
- Mean time to repair (<10 min)
- Automation success rate
- Energy savings %

## 19. Summary
This system is not just a smart switch.

It is:
- A **local-first automation platform**
- A **modular hardware ecosystem**
- A **programmable infrastructure layer for physical spaces**

It competes with existing ecosystems by replacing:
- Cloud dependency → local control
- Monolithic hardware → modular repairability
- Closed APIs → open programmable interfaces

---
