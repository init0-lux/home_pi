# Zapp Hub

The central nervous system of the Zapp local-first smart switch system. A modular monolith built with Node.js + TypeScript + Fastify that handles device orchestration, state management, scheduling, automation, and LLM integration via MCP.

---

## Architecture

```
┌──────────────┐     REST / MCP     ┌─────────────────────┐
│  PWA / LLM   │ ◄────────────────► │     API Layer        │
└──────────────┘                    │  Fastify + JWT       │
                                    └──────────┬──────────┘
                                               │ Internal Event Bus
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
             ┌──────▼──────┐        ┌──────────▼──────┐        ┌─────────▼──────┐
             │ State Mgr   │        │ Automation Eng   │        │ Device Registry│
             │ (auth truth)│        │ (rules + PMS)    │        │ (auto-register)│
             └──────┬──────┘        └──────────┬──────┘        └─────────┬──────┘
                    │                          │                          │
             ┌──────▼──────────────────────────▼──────────────────────────▼──────┐
             │                         SQLite DB                                  │
             └────────────────────────────────────────────────────────────────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │   MQTT Gateway       │
                                    │ (Mosquitto bridge)   │
                                    └──────────┬──────────┘
                                               │ MQTT
                                    ┌──────────▼──────────┐
                                    │   ESP8266 Devices    │
                                    └─────────────────────┘
```

### Core Modules

| Module | Responsibility |
|---|---|
| `event-bus` | Internal typed pub/sub with 1s idempotency deduplication |
| `mqtt-gateway` | MQTT broker bridge — subscribes to all device topics, publishes commands |
| `state-manager` | Single source of truth for all device states (memory + SQLite) |
| `device-registry` | Auto-registers ESP nodes on discovery, tracks heartbeats |
| `scheduler` | 1-second precision time-based automation with cron repeat support |
| `automation-engine` | Reactive rules engine — guest checkin/checkout, device-state triggers |
| `event-logger` | Passive audit log persisting all events to SQLite |
| `health-monitor` | Periodic offline detection based on heartbeat thresholds |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (LTS) |
| Language | TypeScript 5 (strict) |
| Framework | Fastify 4 |
| Database | SQLite via `better-sqlite3` |
| MQTT | `mqtt.js` → Mosquitto 2.0 |
| Auth | Google OAuth + `@fastify/jwt` |
| Validation | Zod |
| Logging | Pino + pino-pretty |
| Testing | Jest + ts-jest |
| Containers | Docker + Docker Compose |

---

## Quick Start

### With Docker (Recommended)

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and MCP_API_KEY

# 2. Start the stack (hub + Mosquitto)
docker compose up -d

# 3. Check health
curl http://localhost:3000/health/ready
```

### Local Development

```bash
# Prerequisites: Node.js 20+, running Mosquitto instance

npm install

# Copy and configure env
cp .env.example .env
# Set MQTT_HOST=localhost (or wherever Mosquitto is running)

# Run with hot-reload
npm run dev

# Build for production
npm run build
npm start
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment (`development` / `production`) |
| `PORT` | `3000` | HTTP server port |
| `MQTT_HOST` | `localhost` | Mosquitto broker hostname |
| `MQTT_PORT` | `1883` | Mosquitto broker port |
| `MQTT_USERNAME` | _(empty)_ | MQTT auth username (optional) |
| `MQTT_PASSWORD` | _(empty)_ | MQTT auth password (optional) |
| `DB_PATH` | `./data/zapp.db` | SQLite database file path |
| `GOOGLE_CLIENT_ID` | _(empty)_ | Google OAuth client ID for login |
| `JWT_SECRET` | _(insecure default)_ | **Change in production!** JWT signing secret |
| `JWT_EXPIRY` | `7d` | JWT token expiry duration |
| `DEVICE_OFFLINE_THRESHOLD_SECONDS` | `30` | Seconds without heartbeat before marking device offline |
| `LOG_LEVEL` | `info` | Pino log level (`trace`/`debug`/`info`/`warn`/`error`) |
| `MCP_ENABLED` | `true` | Enable the LLM MCP tool server |
| `MCP_API_KEY` | _(empty)_ | **Change in production!** Pre-shared key for MCP API |
| `CORS_ORIGINS` | `http://localhost:3001` | Comma-separated allowed CORS origins |
| `PROPERTY_ID` | `default-property` | Hub property identifier |
| `HUB_NAME` | `Zapp Hub` | Human-readable hub name |

---

## REST API

### Base URL
```
http://<hub-ip>:3000
```

### Authentication
All API routes (except `/health`, `/health/ready`, `/auth/google`) require a `Bearer` JWT token:
```
Authorization: Bearer <token>
```

---

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | ❌ | Liveness probe — always returns 200 if process is alive |
| `GET` | `/health/ready` | ❌ | Readiness probe — checks DB, MQTT, Scheduler |
| `GET` | `/health/status` | ✅ | Full system metrics (memory, uptime, device counts) |
| `GET` | `/health/devices` | ✅ | Device online/offline summary by room |
| `GET` | `/health/events` | ✅ | Recent system events (audit log) |

---

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/google` | ❌ | Exchange Google ID token for hub JWT |
| `GET` | `/auth/me` | ✅ | Get current user profile |
| `PATCH` | `/auth/me` | ✅ | Update current user profile |
| `POST` | `/auth/logout` | ✅ | Logout (client-side token discard) |
| `GET` | `/auth/users` | ✅ Admin | List all users |
| `PATCH` | `/auth/users/:id/role` | ✅ Admin | Change a user's role |

**Login example:**
```bash
curl -X POST http://localhost:3000/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "<google-id-token>"}'
```

---

### Devices

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/devices` | ✅ | List all devices with state + status |
| `GET` | `/api/v1/devices/:id` | ✅ | Get single device |
| `POST` | `/api/v1/devices` | ✅ Operator | Manually register a device |
| `PATCH` | `/api/v1/devices/:id` | ✅ Operator | Update device metadata |
| `DELETE` | `/api/v1/devices/:id` | ✅ Admin | Remove device |
| `POST` | `/api/v1/devices/:id/action` | ✅ Operator | Send ON/OFF command |
| `POST` | `/api/v1/devices/:id/toggle` | ✅ Operator | Toggle device state |
| `GET` | `/api/v1/devices/:id/state` | ✅ | Get device channel states |
| `GET` | `/api/v1/devices/:id/events` | ✅ | Get device event history |

**Control a device:**
```bash
curl -X POST http://localhost:3000/api/v1/devices/<device-id>/action \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"state": "ON", "channel": 0}'
```

---

### Rooms

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/rooms` | ✅ | List all rooms with devices + states |
| `GET` | `/api/v1/rooms/:id` | ✅ | Get room with all device states |
| `POST` | `/api/v1/rooms` | ✅ Operator | Create a room |
| `PATCH` | `/api/v1/rooms/:id` | ✅ Operator | Update room |
| `DELETE` | `/api/v1/rooms/:id` | ✅ Admin | Delete room |
| `POST` | `/api/v1/rooms/:id/action` | ✅ Operator | Control all devices in room |
| `GET` | `/api/v1/rooms/:id/state` | ✅ | Get all device states in room |

---

### PMS / Guests

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/guest/checkin` | ✅ Operator | Check in a guest → activates room devices |
| `POST` | `/api/v1/guest/checkout` | ✅ Operator | Check out a guest → deactivates room devices |
| `GET` | `/api/v1/guest/active` | ✅ | List all currently active guests |
| `GET` | `/api/v1/guest/:id` | ✅ | Get a guest record |

**Guest check-in:**
```bash
curl -X POST http://localhost:3000/api/v1/guest/checkin \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "guestId": "G-123",
    "roomId": "<room-uuid>",
    "checkinTime": 1712000000
  }'
```

---

### Schedules

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/schedules` | ✅ | List all schedules |
| `GET` | `/api/v1/schedules/:id` | ✅ | Get a schedule |
| `POST` | `/api/v1/schedules` | ✅ Operator | Create a schedule |
| `PATCH` | `/api/v1/schedules/:id` | ✅ Operator | Update a schedule |
| `DELETE` | `/api/v1/schedules/:id` | ✅ Operator | Delete a schedule |

**Create a repeating schedule (lights ON at 7am daily):**
```bash
curl -X POST http://localhost:3000/api/v1/schedules \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Morning lights",
    "roomId": "<room-uuid>",
    "action": {"state": "ON"},
    "runAt": 1712000000,
    "repeatCron": "0 7 * * *"
  }'
```

---

### Automations

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/automations` | ✅ | List all automation rules |
| `GET` | `/api/v1/automations/:id` | ✅ | Get an automation rule |
| `POST` | `/api/v1/automations` | ✅ Operator | Create an automation rule |
| `PATCH` | `/api/v1/automations/:id` | ✅ Operator | Update an automation rule |
| `DELETE` | `/api/v1/automations/:id` | ✅ Operator | Delete an automation rule |
| `POST` | `/api/v1/automations/:id/trigger` | ✅ Operator | Manually fire an automation |

---

## MCP Tool Server (LLM Integration)

The MCP server exposes device control as callable tools for LLMs. All MCP endpoints require the `X-API-Key` header (or `Authorization: Bearer <key>`).

```
X-API-Key: <MCP_API_KEY>
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/mcp/tools` | List all available tools + schemas |
| `POST` | `/mcp/tools/call` | Call a tool by name with `{name, input}` envelope |
| `POST` | `/mcp/tools/:name` | Call a tool directly (body = tool input) |
| `GET` | `/mcp/tools/:name` | Get schema for a specific tool |

### Available Tools

| Tool | Description |
|---|---|
| `list_devices` | List all registered devices |
| `get_device_state` | Get state of a device channel |
| `set_device_state` | Turn a device ON or OFF |
| `toggle_device` | Toggle a device state |
| `list_rooms` | List all rooms |
| `get_room_state` | Get all device states in a room |
| `set_room_state` | Control all devices in a room |
| `list_automations` | List all automation rules |
| `trigger_automation` | Manually trigger an automation |
| `list_schedules` | List all schedules |
| `create_schedule` | Create a time-based schedule |
| `get_system_status` | Get hub health summary |

**Example — turn off all devices in a room:**
```bash
curl -X POST http://localhost:3000/mcp/tools/set_room_state \
  -H "X-API-Key: <mcp-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"roomId": "<room-uuid>", "state": "OFF"}'
```

---

## MQTT Topics

Zapp Hub subscribes to and publishes on the following topics:

| Topic | Direction | Payload | Description |
|---|---|---|---|
| `home/{room}/{device}/state` | Subscribe | `{"deviceId","channel","state","timestamp"}` | Device reports state change |
| `home/{device}/heartbeat` | Subscribe | `{"deviceId","online","ip","firmware"}` | Device liveness signal |
| `home/discovery` | Subscribe | `{"deviceId","type","room","ip"}` | Device announces itself on boot |
| `home/{room}/{device}/set` | Publish | `{"state","channel","timestamp"}` | Hub sends command to device |
| `home/{device}/ota` | Publish | `{"url","version","timestamp"}` | Hub triggers OTA update |
| `home/hub/status` | Publish | `{"online","timestamp"}` | Hub liveness (retained, LWT) |

---

## Device Auto-Registration

ESP devices auto-register by publishing to `home/discovery`:
```json
{
  "deviceId": "esp-abc123",
  "type": "relay",
  "room": "room101",
  "ip": "192.168.1.42",
  "firmware": "1.0.0"
}
```

The hub:
1. Creates a `devices` record if not already known
2. Updates `ip_address` and `firmware_version` on reconnect
3. Starts tracking heartbeats for online/offline detection

---

## Database Schema

```sql
-- Rooms in a property
rooms(id, name, property_id, created_at)

-- Registered ESP devices
devices(id, room_id, type, name, ip_address, firmware_version, created_at, updated_at)

-- Latest state per device (upserted, last-write-wins)
states(device_id, channel, state, updated_at)

-- Device heartbeat + online status
heartbeats(device_id, last_seen, online)

-- Append-only event audit log
events(id, type, device_id, room_id, payload, timestamp)

-- Time-based automation schedules
schedules(id, name, device_id, room_id, action, run_at, repeat_cron, enabled, last_run_at, created_at)

-- Reactive automation rules
automations(id, name, trigger, actions, enabled, created_at)

-- Google OAuth users
users(id, email, name, picture, role, created_at, last_login)

-- PMS guest records
guests(id, name, room_id, checkin_time, checkout_time, active, created_at)

-- Idempotency keys (dedup cache)
idempotency_keys(key, created_at)
```

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm test -- --coverage
```

Tests use in-memory SQLite and mock all external dependencies (MQTT, logger, config) for hermetic, fast execution.

---

## Docker

```bash
# Build image
docker compose build

# Start stack (hub + Mosquitto)
docker compose up -d

# View logs
docker compose logs -f hub
docker compose logs -f mosquitto

# Stop and remove volumes
docker compose down -v

# Rebuild after code changes
docker compose build hub && docker compose up -d hub
```

### Container Health Checks

- **`zapp-mosquitto`**: Uses `mosquitto_pub` to verify broker accepts connections.
- **`zapp-hub`**: Polls `GET /health` every 15 seconds.

---

## Production Deployment (Raspberry Pi)

```bash
# Install Docker on Pi
curl -fsSL https://get.docker.com | sh

# Clone repo and navigate to hub
git clone <repo> && cd <repo>/hub

# Configure production env
cp .env.example .env
nano .env  # Set JWT_SECRET, MCP_API_KEY, GOOGLE_CLIENT_ID, etc.

# Start
docker compose up -d

# Enable auto-start on boot
sudo systemctl enable docker
```

The containers restart automatically (`restart: unless-stopped`) on failure or Pi reboot.

---

## Roles

| Role | Permissions |
|---|---|
| `admin` | Full access — all endpoints, user management |
| `operator` | Create/update devices, rooms, schedules, guest check-in/out |
| `viewer` | Read-only access to devices, rooms, states |

The **first user to log in** via Google OAuth is automatically granted the `admin` role.

---

## Graceful Shutdown

The hub handles `SIGTERM`, `SIGINT`, and `SIGHUP`:

1. HTTP server stops accepting requests
2. Scheduler and health monitor stop
3. Hub publishes `home/hub/status → {online: false}` via MQTT LWT
4. MQTT gateway disconnects cleanly
5. SQLite connection closes
6. Process exits with code 0