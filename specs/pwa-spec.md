# Zapp - PWA Specification

---

## 1. Overview

### 1.1 Purpose
The PWA is the **primary human interface layer** for the system.

It serves four roles:
- Device control (lights, fans, AC)
- Device provisioning (ESP onboarding)
- Room-level monitoring (Zostel operations)
- LLM-based control (chat interface)

### 1.2 Design Philosophy
- **Local-first UX** (instant response, no cloud lag)
- **Minimal friction** (especially provisioning)
- **Visually premium** (hotel-grade UI)
- **Deterministic behavior** (no ambiguity in state)

## 2. Core Architecture

### 2.1 Connectivity Model
```text
PWA
├── Try: http://hub.local (mDNS)
├── Fallback: http://<hub-ip>
└── Future: cloud endpoint
```

### 2.2 Data Flow
```text
User Action
→ REST API (Hub)
→ MQTT publish
→ Device
→ MQTT state update
→ Hub DB
→ PWA polling refresh
```

### 2.3 State Model
#### Source of Truth
- Hub (SQLite)

#### PWA Behavior
- Poll every 2–3 seconds
- Cache last known state
- Show degraded mode if offline

## 3. Tech Stack

### 3.1 Frontend
- Framework: **Next.js (App Router)**
- Styling: **Tailwind CSS**
- State: **Zustand**
- Data fetching: **React Query**

### 3.2 PWA Features
- Service Worker
- Offline cache (UI + last state)
- Add to Home Screen support
- Fast load (<1s on local network)

### 3.3 Design System
Built with:
- **Google Stitch**
- Stitch MCP inside Antigravity

Focus:
- Glassmorphism / soft UI
- High-contrast toggles
- Room-based visual grouping

## 4. User Roles

### 4.1 Admin
- Full access
- Multi-room control
- Provisioning

### 4.2 Guest
- Restricted scope:
  - Only assigned room
  - Device control only

### 4.3 Authentication
- Google OAuth (via hub backend)
- Token stored locally
- No RBAC in MVP (future)

## 5. Core Features

### 5.1 Device Control
#### UI Structure
```text
Home
└── Room List
└── Room View
└── Device Cards
```

#### Device Card
Each device shows:
- Name (Light 1, Fan, AC)
- State (ON/OFF)
- Toggle button
- Status indicator (online/offline)

#### Interaction
- Tap → instant toggle (optimistic UI)
- Sync via polling

### 5.2 Room View
#### Components
- Room title
- All devices in a grid
- Group actions:
  - All ON
  - All OFF

#### UX Behavior
- Fast toggling (<200ms perceived)
- Smooth transitions
- Visual feedback (color/state change)

### 5.3 Provisioning Flow
#### 5.3.1 Flow Overview
```text
User → Open PWA
→ Click "Add Device"
→ Connect to ESP Wi-Fi manually
→ Return to PWA
→ Enter:
   - Wi-Fi credentials
   - Room assignment
→ Send config
→ Device reboots
→ Auto-registers with hub
```

#### 5.3.2 Screens
1. **Add Device Screen**
   - Instructions
   - Button: "Connect to Device"

2. **Config Screen**
   - Wi-Fi SSID
   - Password
   - Room dropdown
   - Device type (light/fan/AC)

3. **Success Screen**
   - "Device added successfully"
   - Auto-redirect to room

#### 5.3.3 Constraints
- Browser cannot switch Wi-Fi automatically
- Manual step required

### 5.4 Device Health (Basic)
#### Indicators
- Online (green)
- Offline (red)
- Last-seen timestamp

#### Display
- Small dot on device card
- Optional room-level alert

### 5.5 AC Control (IR)
#### MVP
- ON / OFF only

#### UI
- Same card model as light
- Icon: AC symbol

### 5.6 LLM Chat Interface (MCP)
#### 5.6.1 Purpose
Enable:
> Natural language control of devices

#### 5.6.2 UI
- Chat screen (ChatGPT-style)
- Input box
- Message history

#### 5.6.3 Example Commands
- "Turn off all lights in Room 101"
- "Switch on fan"

#### 5.6.4 Backend Flow
```text
User input
→ PWA → Hub MCP endpoint
→ LLM processes
→ Calls API
→ MQTT → Device
→ State updated
```

#### 5.6.5 LLM Options
Initial:
- OpenAI API
- Google Gemini API

Later:
- Local LLM (privacy mode)

## 6. UI/UX Design

### 6.1 Visual Language
- Premium hospitality feel
- Soft gradients
- Large touch targets
- Minimal clutter

### 6.2 Interaction Design
- Instant feedback
- Subtle animations
- No lag perception

### 6.3 Layout
#### Mobile-first
- Single column
- Swipe navigation (future)

#### Desktop
- Grid layout
- Multi-room overview (admin)

## 7. Offline Behavior

### 7.1 Scenarios
| Case | Behavior |
| --- | --- |
| Hub down | Show cached state |
| Network lost | Disable controls |
| Reconnect | Auto refresh |

### 7.2 UI State
- Banner: "Connection lost"
- Greyed-out toggles

## 8. Performance Targets
- Load time: <1s (local)
- Toggle latency: <300ms
- Poll interval: 2–3s

## 9. Security

### MVP
- Google OAuth
- Token stored in `localStorage`

### Future
- RBAC
- Device-level permissions
- Guest session expiry

## 10. Future Enhancements

### 10.1 Real-Time Updates
- WebSockets instead of polling

### 10.2 Alerts
- Device offline alerts
- Push notifications

### 10.3 Automation UI
- Rule builder
- Scene editor

### 10.4 Multi-Property Support
- Cloud dashboard
- Aggregated control

### 10.5 Native-Like Features
- Push notifications
- Background sync

## 11. API Contracts (PWA → Hub)

### Devices
```http
GET /devices
POST /devices/:id/action
```

### Rooms
```http
GET /rooms
GET /rooms/:id
```

### Provisioning
```http
POST /provision
```

### MCP
```http
POST /mcp/query
```

## 12. Development Plan

### Phase 1 (Week 1–2)
- Basic UI
- Device list + toggle
- Polling

### Phase 2 (Week 3–4)
- Room views
- Provisioning flow
- Auth (Google)

### Phase 3 (Week 5–6)
- LLM chat interface
- MCP integration
- UI polish

## 13. Risks
- Provisioning UX friction
- Polling inefficiency
- LLM latency
- Wi-Fi switching limitations

## 14. Summary
The PWA is:
- A **control plane** for physical infrastructure
- A **provisioning tool**
- A **chat-based interface (LLM-native)**
- A **local-first application with cloud extensibility**

It must feel:
> Instant, reliable, and premium
```
