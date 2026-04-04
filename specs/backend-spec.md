# Zapp - Backend Specification

---

## 1. Overview

### 1.1 Purpose
The backend (hub) is the **central nervous system** of the product.

It is responsible for:
- State authority (single source of truth)
- Device orchestration (via MQTT)
- Event processing (event-driven system)
- Automation execution
- API + MCP interface
- Authentication (Google OAuth)
- OTA distribution

### 1.2 Architecture Style
**Modular monolith (Node.js + TypeScript)**

- Single deployable service
- Internally divided into isolated modules
- Optimized for Raspberry Pi constraints

## 2. High-Level Architecture

```text
            ┌──────────────┐
            │     PWA      │
            └──────┬───────┘
                   │ REST
            ┌──────▼───────┐
            │   API Layer  │
            └──────┬───────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
State Manager   Event Bus     Device Registry
    │              │              │
    ▼              ▼              ▼
 SQLite DB     Automation      MQTT Gateway
    │              │
    ▼              ▼
Scheduler       Mosquitto
    │
    ▼
ESP Devices
```

## 3. Core Design Principles
- **Hub is authoritative**
- **Event-driven system**
- **Devices are stateless executors**
- **Local-first execution**
- **Idempotent operations**
- **Low resource footprint**

## 4. Module Architecture

### 4.1 Core Modules
```text
/core
  mqtt-gateway
  event-bus
  state-manager
  device-registry
  scheduler
  automation-engine
```

### 4.2 API Layer
```text
/api
  rest
  auth
  middleware
```

### 4.3 MCP Layer
```text
/mcp
  tool-router
  validator
  executor
```

### 4.4 System Modules
```text
/system
  ota
  logging
  health
```

## 5. Event-Driven Architecture

### 5.1 Event Bus
All system interactions are events.

#### Event Type Example
```json
{
  "type": "DEVICE_STATE_CHANGED",
  "deviceId": "abc123",
  "state": "ON",
  "timestamp": 1712000000
}
```

### 5.2 Flow
```text
MQTT → Event Bus → State Manager → DB
                     ↓
               Automation Engine
                     ↓
                MQTT Publish
```

### 5.3 Idempotency
- Duplicate events are ignored
- Idempotency key basis:
  - `deviceId + timestamp`

## 6. MQTT Gateway

### 6.1 Responsibilities
- Subscribe to all device topics
- Publish commands to devices
- Convert MQTT messages to internal events

### 6.2 Topic Structure
```text
home/{room}/{device}/set
home/{room}/{device}/state
home/{device}/heartbeat
```

### 6.3 QoS
- QoS level: **1 (at least once)**

## 7. State Manager

### 7.1 Responsibilities
- Maintain latest device state
- Persist state to SQLite
- Serve state to API

### 7.2 Source of Truth
- Hub DB always overrides device state

### 7.3 State Update Flow
```text
Event → State Manager → DB → Notify API
```

## 8. Device Registry

### 8.1 Responsibilities
- Auto-register devices
- Map:
  - Device → room
  - Device → type

### 8.2 Registration Flow
```text
Device connects
→ Publishes metadata
→ Auto-register
→ Stored in DB
```

## 9. Scheduler

### 9.1 Responsibilities
- Execute time-based events
- 1-second precision

### 9.2 Storage
- Stored in SQLite

## 10. Automation Engine

### 10.1 MVP Scope
- Backend-triggered only:
  - PMS check-in
  - Scheduled events

### 10.2 Flow
```text
Trigger → Event Bus → Automation Engine
→ Generate actions → MQTT publish
```

## 11. Database Design (SQLite)

### 11.1 Tables

#### Devices
```sql
devices (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  type TEXT,
  created_at INTEGER
)
```

#### States
```sql
states (
  device_id TEXT,
  state TEXT,
  updated_at INTEGER
)
```

#### Events (Full History)
```sql
events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  payload TEXT,
  timestamp INTEGER
)
```

#### Rooms
```sql
rooms (
  id TEXT PRIMARY KEY,
  name TEXT
)
```

#### Users
```sql
users (
  id TEXT PRIMARY KEY,
  email TEXT
)
```

## 12. API Layer

### 12.1 REST Endpoints

#### Devices
```http
GET  /devices
POST /devices/:id/action
```

#### Rooms
```http
GET /rooms
GET /rooms/:id
```

#### PMS
```http
POST /guest/checkin
```

#### Auth
```http
POST /auth/google
```

## 13. Authentication

### 13.1 Method
- Google OAuth

### 13.2 Flow
```text
PWA → Google Login → Token
→ Backend verifies token
→ Create session
```

### 13.3 Recommendation
- Use Google ID token verification (server-side)
- Store minimal user info

## 14. MCP Layer

### 14.1 Components
- Tool router
- Validator
- Executor

### 14.2 Flow
```text
LLM Request
→ Validator
→ Executor
→ API / MQTT
```

### 14.3 Safety
- Validate:
  - Device existence
  - Action validity

## 15. OTA System

### 15.1 Strategy
- Firmware stored locally on hub

### 15.2 Flow
```text
Hub → MQTT trigger
→ Device pulls firmware
→ Update
```

## 16. Logging

### 16.1 MVP
- Simple console logs

### 16.2 Events Logged
- Device state changes
- Errors
- MQTT messages

## 17. Health Monitoring

### 17.1 Heartbeat
- Device publishes every **10s**

### 17.2 Tracking
- Last-seen timestamp
- Mark offline if >30s

## 18. Failure Handling

### 18.1 Hub Restart
- Devices resend state
- Hub rebuilds state

### 18.2 Device Offline
- Mark as offline
- Retain last state

### 18.3 MQTT Failure
- Auto-reconnect

## 19. Performance Constraints
- Max ~5 concurrent requests
- Low CPU footprint
- Minimal memory usage

## 20. Deployment

### 20.1 Environment
- Raspberry Pi

### 20.2 Services
- Node.js backend
- Mosquitto
- SQLite

### 20.3 Process Manager
- `systemd`

## 21. Future Enhancements
- WebSocket real-time updates
- RBAC (admin/guest separation)
- Cloud sync layer
- Analytics
- Distributed hubs

## 22. Summary
The backend is:
- Event-driven
- State-authoritative
- Modular but lightweight
- Fully local-first
- Extensible via MCP

It ensures:
- Deterministic control
- Reliability under network failures
- Scalability across properties
```
