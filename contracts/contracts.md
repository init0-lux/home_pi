# Contracts
## System-Wide Contracts (Single Source of Truth)

---

## 1. Overview

This document defines all shared contracts across:
- Firmware (ESP8266)
- Backend (hub)
- PWA
- MCP / LLM layer

**Rule:**
> No component may define its own schema. Every component must follow this file.

## 2. Identifiers

### 2.1 Device ID
- Type: `string` (UUID v4)
- Example:

```json
{
  "deviceId": "a3f1c2e4-9b12-4f6a-8c1d-92ab3e1f7c21"
}
```

### 2.2 Room ID
- Type: `string`
- Example:

```json
{
  "roomId": "room-101"
}
```

## 3. MQTT Contract

### 3.1 Topic Structure
```text
home/{roomId}/{deviceId}/set
home/{roomId}/{deviceId}/state
home/{deviceId}/heartbeat
home/{deviceId}/meta
```

### 3.2 State Payload
#### Command (`/set`)
```json
{
  "state": "ON"
}
```

#### State Update (`/state`)
```json
{
  "deviceId": "string",
  "roomId": "string",
  "state": "ON",
  "timestamp": 1712000000
}
```

### 3.3 Heartbeat
```json
{
  "deviceId": "string",
  "status": "ONLINE",
  "timestamp": 1712000000
}
```

Interval: **10 seconds**

### 3.4 Device Metadata (Discovery)
```json
{
  "deviceId": "string",
  "roomId": "string",
  "type": "light",
  "capabilities": ["on", "off"],
  "firmwareVersion": "1.0.0"
}
```

### 3.5 QoS
- Level: **1 (at least once)**

## 4. Event Contract (Internal)

### 4.1 Event Format
```json
{
  "type": "DEVICE_STATE_CHANGED",
  "payload": {
    "deviceId": "string",
    "state": "ON"
  },
  "timestamp": 1712000000
}
```

### 4.2 Event Types
- `DEVICE_STATE_CHANGED`
- `DEVICE_REGISTERED`
- `DEVICE_HEARTBEAT`
- `COMMAND_EXECUTED`
- `PMS_TRIGGER`

## 5. REST API Contract

### 5.1 Devices
#### `GET /devices`
Response:

```json
[
  {
    "deviceId": "string",
    "roomId": "string",
    "type": "light",
    "state": "ON",
    "online": true
  }
]
```

#### `POST /devices/:id/action`
Request:

```json
{
  "state": "ON"
}
```

### 5.2 Rooms
#### `GET /rooms`
```json
[
  {
    "roomId": "room-101",
    "devices": []
  }
]
```

### 5.3 PMS
#### `POST /guest/checkin`
```json
{
  "guestId": "string",
  "roomId": "string"
}
```

## 6. MCP Contract

### 6.1 Tool Definition
```json
{
  "name": "set_device_state",
  "params": {
    "deviceId": "string",
    "state": "ON"
  }
}
```

### 6.2 Query Endpoint
`POST /mcp/query`

```json
{
  "query": "Turn on room 101 light"
}
```

## 7. State Rules
- Hub is authoritative
- Devices must accept hub state
- Duplicate events are ignored
- Last-write-wins

## 8. Time Standard
- All timestamps use Unix epoch seconds

## 9. Error Contract
```json
{
  "error": "DEVICE_NOT_FOUND",
  "message": "Device does not exist"
}
```

## 10. Versioning
Future-proof envelope:

```json
{
  "version": "1.0"
}

```
