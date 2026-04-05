# Zapp — Live Demo Guide

## System Overview

```
Phone (PWA) ──── WiFi ──── Laptop (Hub) ──── MQTT ──── ESP8266 (Relay)
              zapp.local:3001             localhost:1883
```

## Prerequisites (on the hub laptop)

```bash
# Install Node.js 20+, pnpm, mosquitto
sudo apt install -y mosquitto mosquitto-clients nodejs
npm install -g pnpm
```

---

## Step 1 — Start Mosquitto (MQTT broker)

```bash
sudo systemctl start mosquitto
# or manually:
mosquitto -v
```

Verify: `mosquitto_sub -t '#' -v`  — you should see a prompt waiting for messages.

---

## Step 2 — Start the Hub (backend)

```bash
cd zapp/hub
pnpm install          # first time only
pnpm dev
```

You should see:
```
✅ Zapp Hub is fully operational
📡 mDNS service published — hub accessible at http://zapp.local:3000
skipAuth: true
```

Keep this terminal open — the logs are your demo dashboard.

---

## Step 3 — Start the Dashboard (PWA)

In a **new terminal**:

```bash
cd zapp/worktrees/mobile/dashboard
pnpm install          # first time only
pnpm dev
```

The dashboard runs on **http://localhost:3001** (or the port Next.js picks).

### Verify API connection

Open http://localhost:3001 in a browser. The hub status dot (top right) should be **green**.

---

## Step 4 — Expose via mDNS or ngrok

### Option A — mDNS (same WiFi network)

Both the hub and dashboard are accessible on the LAN:
- Hub API:   `http://zapp.local:3000`
- Dashboard: `http://<laptop-ip>:3001`

On the phone, navigate to `http://<laptop-ip>:3001` and **Add to Home Screen**.

### Option B — ngrok (any network)

```bash
# Terminal 1: tunnel to hub
ngrok http 3000

# Terminal 2: tunnel to dashboard  
ngrok http 3001
```

Set the dashboard env to point at the hub's ngrok URL:
```bash
# zapp/worktrees/mobile/dashboard/.env.local
NEXT_PUBLIC_HUB_URL=https://xxxx.ngrok.app
```

Then restart the dashboard: `pnpm dev`

Open the dashboard ngrok URL on your phone → Add to Home Screen.

---

## Step 5 — Provision the ESP8266

> **The ESP must be freshly flashed or have no stored WiFi credentials.**

1. Power on the ESP8266.
2. It will start a WiFi hotspot: **`ZappDevice-XXXX`** (no password).
3. On your phone, open the Zapp PWA → tap **+** (Add Device).
4. Follow the wizard:
   - **Step 1**: Read instructions, tap **Get Started**
   - **Step 2**: Go to phone WiFi settings → connect to `ZappDevice-XXXX` → return to app → tap **I'm Connected**
   - **Step 3**: Enter home WiFi SSID + password → optionally assign to a room → tap **Provision Device**
5. The app sends the config to `http://192.168.4.1/configure`.
6. The ESP saves credentials and reboots.
7. Reconnect your phone to the home WiFi.

### Verify provisioning

In the hub terminal you should see:
```
[MQTT] Discovery published — device: zapp-xxxx, room: ...
Device registered  deviceId: "zapp-xxxx"
```

The device also appears in the dashboard within ~5 seconds.

---

## Step 6 — Control the Relay

1. In the Zapp PWA, tap the room the device was assigned to.
2. Tap the device card toggle → relay should click.
3. Hub logs show:
   ```
   Device action executed via API  state: ON  mqttPublished: true
   ```
4. Physical button on the ESP also toggles the relay and syncs back.

---

## Step 7 — MCP

### Via the chat UI

Open the **Chat** tab in the PWA and try:
- "turn on relay"
- "turn off all"
- "show status"

### Via curl / Claude Desktop

```bash
# List tools
curl http://localhost:3000/mcp/tools | jq .

# Call a tool directly
curl -X POST http://localhost:3000/mcp/tools/set_device_state \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"<device-id>","state":"ON","channel":0}'
```

In Claude Desktop `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "zapp": {
      "url": "http://zapp.local:3000/mcp/tools"
    }
  }
}
```

---

## Quick Reference

| Service | URL | Notes |
|---------|-----|-------|
| Hub API | `http://zapp.local:3000` | Fastify + MQTT + SQLite |
| Dashboard | `http://<ip>:3001` | Next.js PWA |
| MQTT | `localhost:1883` | Mosquitto |
| ESP AP | `192.168.4.1` | Only in provisioning mode |
| Health | `http://zapp.local:3000/health` | No auth |
| MCP tools | `http://zapp.local:3000/mcp/tools` | No auth (SKIP_AUTH=true) |

## Demo Flow Cheatsheet

```
1. Start mosquitto        → sudo systemctl start mosquitto
2. Start hub              → cd hub && pnpm dev
3. Start dashboard        → cd worktrees/mobile/dashboard && pnpm dev
4. Phone: open PWA        → http://<laptop-ip>:3001
5. Phone: provision ESP   → tap + → connect to ZappDevice-XXXX → fill form
6. Phone: control relay   → tap device toggle
7. Demo MCP               → chat tab or curl
```

## Resetting for a Fresh Demo

```bash
# Clear hub database (removes all devices/rooms)
rm -f hub/data/zapp.db

# Reset ESP (clear EEPROM + restart AP mode)
# Option 1: In Arduino IDE → upload a sketch that calls clearConfig()
# Option 2: POST to ESP while on its hotspot:
curl -X POST http://192.168.4.1/reset
```
