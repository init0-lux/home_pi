# Distributed Local Home Automation MVP

Academic embedded systems evaluation project for a local-only home automation system.

## 🚀 Features
- **Local-Only**: Works without internet, no cloud dependencies.
- **Distributed**: ESP8266 nodes control physical relays and buttons.
- **Persistence**: State is saved in SQLite and ESP8266 EEPROM.
- **Scheduling**: Execute actions at specific Unix epoch times (1s precision).
- **Aesthetic Dashboard**: Modern UI for monitoring and control.

## 🏗️ Project Structure
- `/server`: Node.js backend (Express, SQLite, MQTT.js).
- `/public`: Pure HTML/CSS/JS dashboard.
- `/firmware`: ESP8266 Arduino code.
- `/database`: SQLite storage.

## 🛠️ Setup Instructions (Raspberry Pi)

1. **Install Dependencies**:
   ```bash
   sudo apt update
   sudo apt install -y nodejs npm mosquitto mosquitto-clients sqlite3
   ```

2. **Configure MQTT**:
   Ensure Mosquitto is running:
   ```bash
   sudo systemctl enable mosquitto
   sudo systemctl start mosquitto
   ```

3. **Install and Build Backend**:
   Navigate to `server/` and run:
   ```bash
   npm install
   npm run build
   ```

4. **Service Installation**:
   ```bash
   sudo cp home-automation.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable home-automation.service
   sudo systemctl start home-automation.service
   ```

## 🔌 Hardware Setup (ESP8266)

### Pin Mapping
| Component | Pin | Port |
|-----------|-----|------|
| Relay 1   | D1  | GPIO5 |
| Relay 2   | D2  | GPIO4 |
| Relay 3   | D5  | GPIO14|
| Relay 4   | D6  | GPIO12|
| Button 1  | D7  | GPIO13|
| Button 2  | D3  | GPIO0 |
| Button 3  | D8  | GPIO15|
| Button 4  | RX  | GPIO3 |

### Library Requirements
- `ESP8266WiFi`
- `PubSubClient`
- `EEPROM`
- `ArduinoJson` (v6+)

## 📡 MQTT Topics
- `home/appliance/{1-4}/set`: Control commands (JSON: `{"state": 0/1}`)
- `home/appliance/{1-4}/status`: Current state updates
- `home/node/status`: Heartbeat (`{"online": true}`)

## 💻 Web Dashboard
Access the dashboard via: `http://<pi-ip-address>:3000`
- **Polling**: Updates every 2 seconds.
- **Indicator**: Top right dot shows Node status (Online/Offline).
