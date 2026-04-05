/*
 * Zapp Node — ESP8266 Firmware
 * ============================================================
 * Local-first smart switch firmware for the Zapp hub system.
 *
 * Features:
 *   - AP provisioning mode (POST /configure with CORS support)
 *   - WiFi STA mode with reconnect loop
 *   - MQTT: subscribe to set commands, publish state + heartbeat
 *   - Relay control (up to 4 channels)
 *   - Physical button edge-triggered toggle (interrupt-based)
 *   - OTA update trigger via MQTT
 *   - EEPROM persistence of config + last state
 *   - mDNS for hub discovery (hub.local fallback)
 *
 * MQTT Topics:
 *   Subscribe: home/<roomId>/<deviceId>/set
 *   Publish:   home/<roomId>/<deviceId>/state
 *              home/<deviceId>/heartbeat
 *              home/discovery
 *
 * Provisioning endpoint (AP mode, 192.168.4.1):
 *   POST /configure  { ssid, password, mqttHost, mqttPort, deviceId, roomId }
 *   GET  /           returns device info JSON
 *
 * Board: ESP8266 (NodeMCU / Wemos D1 Mini)
 * Dependencies:
 *   - ESP8266WiFi (built-in)
 *   - ESP8266WebServer (built-in)
 *   - ESP8266mDNS (built-in)
 *   - PubSubClient by knolleary
 *   - ArduinoJson v6 by bblanchon
 *   - EEPROM (built-in)
 *   - ESP8266HTTPUpdateServer (built-in, for OTA)
 */

#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ─── Pin Mapping ──────────────────────────────────────────────────────────────

#define RELAY_PIN        D1   // GPIO5  — primary relay (channel 0)
#define RELAY_PIN_2      D2   // GPIO4  — channel 1
#define RELAY_PIN_3      D5   // GPIO14 — channel 2
#define RELAY_PIN_4      D6   // GPIO12 — channel 3
#define BUTTON_PIN       D7   // GPIO13 — physical toggle switch

// Relay logic: most relay boards are ACTIVE LOW
#define RELAY_ON         LOW
#define RELAY_OFF        HIGH

// ─── EEPROM Layout ────────────────────────────────────────────────────────────

#define EEPROM_SIZE      512
#define ADDR_MAGIC       0    // 2 bytes — magic number to detect valid config
#define ADDR_SSID        2    // 64 bytes
#define ADDR_PASS        66   // 64 bytes
#define ADDR_MQTT_HOST   130  // 64 bytes
#define ADDR_MQTT_PORT   194  // 2 bytes
#define ADDR_DEVICE_ID   196  // 32 bytes
#define ADDR_ROOM_ID     228  // 32 bytes
#define ADDR_STATE       260  // 1 byte  — last relay state (channel 0)

#define MAGIC_NUMBER     0xAB42

// ─── Config Struct ────────────────────────────────────────────────────────────

struct DeviceConfig {
  char ssid[64];
  char password[64];
  char mqttHost[64];
  uint16_t mqttPort;
  char deviceId[32];
  char roomId[32];
};

// ─── Globals ──────────────────────────────────────────────────────────────────

DeviceConfig cfg;
bool relayState = false;          // channel 0 state
bool configValid = false;

ESP8266WebServer apServer(80);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// Timing
unsigned long lastHeartbeat   = 0;
unsigned long lastReconnect   = 0;
unsigned long lastDebounce    = 0;

const unsigned long HEARTBEAT_INTERVAL  = 10000;   // 10 s
const unsigned long RECONNECT_INTERVAL  = 5000;    // 5 s
const unsigned long DEBOUNCE_DELAY      = 50;      // 50 ms

// Button
volatile bool buttonPressed = false;
bool lastButtonState = HIGH;

// AP mode
String apSSID;

// ─── EEPROM Helpers ───────────────────────────────────────────────────────────

void eepromWriteString(int addr, const char* str, int maxLen) {
  for (int i = 0; i < maxLen; i++) {
    EEPROM.write(addr + i, (i < (int)strlen(str)) ? str[i] : 0);
  }
}

void eepromReadString(int addr, char* buf, int maxLen) {
  for (int i = 0; i < maxLen; i++) {
    buf[i] = EEPROM.read(addr + i);
  }
  buf[maxLen - 1] = '\0';
}

void saveConfig() {
  uint16_t magic = MAGIC_NUMBER;
  EEPROM.put(ADDR_MAGIC, magic);
  eepromWriteString(ADDR_SSID,      cfg.ssid,      64);
  eepromWriteString(ADDR_PASS,      cfg.password,  64);
  eepromWriteString(ADDR_MQTT_HOST, cfg.mqttHost,  64);
  EEPROM.put(ADDR_MQTT_PORT, cfg.mqttPort);
  eepromWriteString(ADDR_DEVICE_ID, cfg.deviceId,  32);
  eepromWriteString(ADDR_ROOM_ID,   cfg.roomId,    32);
  EEPROM.commit();
  Serial.println("[EEPROM] Config saved.");
}

bool loadConfig() {
  uint16_t magic;
  EEPROM.get(ADDR_MAGIC, magic);
  if (magic != MAGIC_NUMBER) {
    Serial.println("[EEPROM] No valid config found.");
    return false;
  }
  eepromReadString(ADDR_SSID,      cfg.ssid,      64);
  eepromReadString(ADDR_PASS,      cfg.password,  64);
  eepromReadString(ADDR_MQTT_HOST, cfg.mqttHost,  64);
  EEPROM.get(ADDR_MQTT_PORT, cfg.mqttPort);
  eepromReadString(ADDR_DEVICE_ID, cfg.deviceId,  32);
  eepromReadString(ADDR_ROOM_ID,   cfg.roomId,    32);

  if (cfg.mqttPort == 0 || cfg.mqttPort > 65535) cfg.mqttPort = 1883;

  Serial.printf("[EEPROM] Config loaded — SSID: %s, MQTT: %s:%d, Device: %s, Room: %s\n",
    cfg.ssid, cfg.mqttHost, cfg.mqttPort, cfg.deviceId, cfg.roomId);
  return true;
}

void saveRelayState() {
  EEPROM.write(ADDR_STATE, relayState ? 1 : 0);
  EEPROM.commit();
}

bool loadRelayState() {
  return EEPROM.read(ADDR_STATE) == 1;
}

void clearConfig() {
  uint16_t zero = 0;
  EEPROM.put(ADDR_MAGIC, zero);
  EEPROM.commit();
  Serial.println("[EEPROM] Config cleared.");
}

// ─── Relay Control ────────────────────────────────────────────────────────────

void setRelay(bool state) {
  relayState = state;
  digitalWrite(RELAY_PIN, state ? RELAY_ON : RELAY_OFF);
  saveRelayState();
  Serial.printf("[Relay] Channel 0 → %s\n", state ? "ON" : "OFF");
}

void setRelayChannel(int channel, bool state) {
  switch (channel) {
    case 0: digitalWrite(RELAY_PIN,   state ? RELAY_ON : RELAY_OFF); break;
    case 1: digitalWrite(RELAY_PIN_2, state ? RELAY_ON : RELAY_OFF); break;
    case 2: digitalWrite(RELAY_PIN_3, state ? RELAY_ON : RELAY_OFF); break;
    case 3: digitalWrite(RELAY_PIN_4, state ? RELAY_ON : RELAY_OFF); break;
    default: break;
  }
  if (channel == 0) {
    relayState = state;
    saveRelayState();
  }
  Serial.printf("[Relay] Channel %d → %s\n", channel, state ? "ON" : "OFF");
}

// ─── MQTT Topics ──────────────────────────────────────────────────────────────

String topicSet() {
  return String("home/") + cfg.roomId + "/" + cfg.deviceId + "/set";
}

String topicState() {
  return String("home/") + cfg.roomId + "/" + cfg.deviceId + "/state";
}

String topicHeartbeat() {
  return String("home/") + cfg.deviceId + "/heartbeat";
}

// ─── MQTT Publish Helpers ─────────────────────────────────────────────────────

void publishState(int channel = 0, bool state = false) {
  if (!mqttClient.connected()) return;
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId;
  doc["channel"]  = channel;
  doc["state"]    = state ? "ON" : "OFF";
  doc["timestamp"] = millis();
  char buf[128];
  serializeJson(doc, buf);
  mqttClient.publish(topicState().c_str(), buf, true);
  Serial.printf("[MQTT] Published state: %s\n", buf);
}

void publishHeartbeat() {
  if (!mqttClient.connected()) return;
  StaticJsonDocument<256> doc;
  doc["deviceId"] = cfg.deviceId;
  doc["status"]   = "ONLINE";
  doc["online"]   = true;
  doc["ip"]       = WiFi.localIP().toString();
  doc["rssi"]     = WiFi.RSSI();
  doc["firmware"] = "1.0.0";
  doc["timestamp"] = millis();
  char buf[256];
  serializeJson(doc, buf);
  mqttClient.publish(topicHeartbeat().c_str(), buf, false);
}

void publishDiscovery() {
  if (!mqttClient.connected()) return;
  StaticJsonDocument<256> doc;
  doc["deviceId"] = cfg.deviceId;
  doc["type"]     = "relay";
  doc["room"]     = cfg.roomId;
  doc["ip"]       = WiFi.localIP().toString();
  doc["firmware"] = "1.0.0";
  doc["timestamp"] = millis();
  char buf[256];
  serializeJson(doc, buf);
  mqttClient.publish("home/discovery", buf, false);
  Serial.printf("[MQTT] Discovery published — device: %s, room: %s\n",
    cfg.deviceId, cfg.roomId);
}

// ─── MQTT Callback ────────────────────────────────────────────────────────────

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Null-terminate the payload
  char msg[length + 1];
  memcpy(msg, payload, length);
  msg[length] = '\0';

  Serial.printf("[MQTT] Received on %s: %s\n", topic, msg);

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, msg);
  if (err) {
    Serial.printf("[MQTT] JSON parse error: %s\n", err.c_str());
    return;
  }

  // Check for OTA trigger
  if (doc.containsKey("otaUrl")) {
    String url = doc["otaUrl"].as<String>();
    Serial.printf("[OTA] Starting update from: %s\n", url.c_str());
    ESPhttpUpdate.setLedPin(LED_BUILTIN, LOW);
    t_httpUpdate_return ret = ESPhttpUpdate.update(wifiClient, url);
    switch (ret) {
      case HTTP_UPDATE_FAILED:
        Serial.printf("[OTA] Failed: %s\n", ESPhttpUpdate.getLastErrorString().c_str());
        break;
      case HTTP_UPDATE_NO_UPDATES:
        Serial.println("[OTA] No updates.");
        break;
      case HTTP_UPDATE_OK:
        Serial.println("[OTA] Success — rebooting.");
        break;
    }
    return;
  }

  // Relay set command
  const char* stateStr = doc["state"] | "";
  int channel = doc["channel"] | 0;

  bool newState;
  if (strcmp(stateStr, "ON") == 0)  newState = true;
  else if (strcmp(stateStr, "OFF") == 0) newState = false;
  else {
    Serial.println("[MQTT] Unknown state value.");
    return;
  }

  setRelayChannel(channel, newState);

  // Publish updated state back
  publishState(channel, newState);
}

// ─── MQTT Connect ─────────────────────────────────────────────────────────────

bool mqttConnect() {
  Serial.printf("[MQTT] Connecting to %s:%d as %s...\n",
    cfg.mqttHost, cfg.mqttPort, cfg.deviceId);

  mqttClient.setServer(cfg.mqttHost, cfg.mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(5);

  // LWT
  String lwtTopic = topicHeartbeat();
  StaticJsonDocument<128> lwtDoc;
  lwtDoc["deviceId"] = cfg.deviceId;
  lwtDoc["online"]   = false;
  char lwtBuf[128];
  serializeJson(lwtDoc, lwtBuf);

  if (mqttClient.connect(
        cfg.deviceId,
        nullptr, nullptr,   // no auth
        lwtTopic.c_str(), 1, true, lwtBuf)) {

    Serial.println("[MQTT] Connected!");

    // Subscribe to command topic
    mqttClient.subscribe(topicSet().c_str(), 1);
    Serial.printf("[MQTT] Subscribed to %s\n", topicSet().c_str());

    // Announce online
    publishDiscovery();
    publishState(0, relayState);

    return true;
  }

  Serial.printf("[MQTT] Connect failed, rc=%d\n", mqttClient.state());
  return false;
}

// ─── AP Mode / Provisioning Web Server ───────────────────────────────────────

void addCorsHeaders() {
  apServer.sendHeader("Access-Control-Allow-Origin",  "*");
  apServer.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  apServer.sendHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
  apServer.sendHeader("Access-Control-Max-Age",       "86400");
}

void handleOptions() {
  addCorsHeaders();
  apServer.send(204);
}

void handleRoot() {
  addCorsHeaders();
  StaticJsonDocument<256> doc;
  doc["device"]   = apSSID;
  doc["mode"]     = "provisioning";
  doc["endpoint"] = "POST /configure";
  doc["version"]  = "1.0.0";
  char buf[256];
  serializeJson(doc, buf);
  apServer.send(200, "application/json", buf);
}

void handleConfigure() {
  addCorsHeaders();

  if (apServer.method() == HTTP_OPTIONS) {
    apServer.send(204);
    return;
  }

  String body = apServer.arg("plain");
  Serial.printf("[AP] Received config: %s\n", body.c_str());

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    apServer.send(400, "application/json", "{\"ok\":false,\"error\":\"Invalid JSON\"}");
    return;
  }

  const char* ssid     = doc["ssid"]     | "";
  const char* pass     = doc["password"] | "";
  const char* mqttHost = doc["mqttHost"] | "192.168.1.1";
  uint16_t mqttPort    = doc["mqttPort"] | 1883;
  const char* devId    = doc["deviceId"] | "";
  const char* roomId   = doc["roomId"]   | "default";

  if (strlen(ssid) == 0) {
    apServer.send(400, "application/json", "{\"ok\":false,\"error\":\"ssid is required\"}");
    return;
  }

  // Copy to config
  strlcpy(cfg.ssid,      ssid,     sizeof(cfg.ssid));
  strlcpy(cfg.password,  pass,     sizeof(cfg.password));
  strlcpy(cfg.mqttHost,  mqttHost, sizeof(cfg.mqttHost));
  cfg.mqttPort = mqttPort;

  if (strlen(devId) > 0) {
    strlcpy(cfg.deviceId, devId, sizeof(cfg.deviceId));
  }
  if (strlen(roomId) > 0) {
    strlcpy(cfg.roomId, roomId, sizeof(cfg.roomId));
  }

  saveConfig();

  apServer.send(200, "application/json",
    "{\"ok\":true,\"message\":\"Configuration saved. Rebooting...\"}");

  Serial.println("[AP] Config accepted — rebooting in 1s...");
  delay(1000);
  ESP.restart();
}

void startAPMode() {
  // Generate unique AP SSID from chip ID
  uint32_t chipId = ESP.getChipId();
  apSSID = "ZappDevice-" + String(chipId & 0xFFFF, HEX);
  apSSID.toUpperCase();

  Serial.printf("[AP] Starting access point: %s\n", apSSID.c_str());

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apSSID.c_str());  // No password

  IPAddress apIP = WiFi.softAPIP();
  Serial.printf("[AP] IP: %s\n", apIP.toString().c_str());

  // Register handlers
  apServer.on("/",          HTTP_GET,     handleRoot);
  apServer.on("/configure", HTTP_POST,    handleConfigure);
  apServer.on("/configure", HTTP_OPTIONS, handleOptions);
  apServer.on("/reset",     HTTP_POST,    []() {
    addCorsHeaders();
    clearConfig();
    apServer.send(200, "application/json", "{\"ok\":true}");
    delay(500);
    ESP.restart();
  });

  // CORS preflight for all routes
  apServer.onNotFound([]() {
    if (apServer.method() == HTTP_OPTIONS) {
      addCorsHeaders();
      apServer.send(204);
    } else {
      addCorsHeaders();
      apServer.send(404, "application/json", "{\"ok\":false,\"error\":\"Not found\"}");
    }
  });

  apServer.begin();
  Serial.println("[AP] Web server started. Waiting for provisioning...");
}

// ─── Button ISR ───────────────────────────────────────────────────────────────

ICACHE_RAM_ATTR void buttonISR() {
  buttonPressed = true;
}

// ─── WiFi Connect ─────────────────────────────────────────────────────────────

bool connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s...\n", cfg.ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid, cfg.password);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println("[WiFi] Connection failed.");
  return false;
}

// ─── Generate default device ID ───────────────────────────────────────────────

void generateDefaultDeviceId() {
  uint32_t chipId = ESP.getChipId();
  snprintf(cfg.deviceId, sizeof(cfg.deviceId), "zapp-%04x-%04x",
    (chipId >> 16) & 0xFFFF, chipId & 0xFFFF);
  snprintf(cfg.roomId, sizeof(cfg.roomId), "default");
  Serial.printf("[Config] Default device ID: %s\n", cfg.deviceId);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n\n[Zapp] ⚡ Booting...");

  EEPROM.begin(EEPROM_SIZE);

  // Relay pins
  pinMode(RELAY_PIN,   OUTPUT);
  pinMode(RELAY_PIN_2, OUTPUT);
  pinMode(RELAY_PIN_3, OUTPUT);
  pinMode(RELAY_PIN_4, OUTPUT);

  // Button with internal pull-up
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), buttonISR, FALLING);

  // Load config
  configValid = loadConfig();

  if (!configValid) {
    // No config — generate defaults and start AP mode
    generateDefaultDeviceId();
    startAPMode();
    return;
  }

  // Restore last relay state
  relayState = loadRelayState();
  setRelay(relayState);

  // Connect to WiFi
  if (!connectWiFi()) {
    Serial.println("[Boot] WiFi failed — falling back to AP mode.");
    startAPMode();
    return;
  }

  // mDNS for hub discovery
  if (MDNS.begin(cfg.deviceId)) {
    Serial.printf("[mDNS] Started as %s.local\n", cfg.deviceId);
  }

  // Connect to MQTT
  mqttConnect();
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

void loop() {
  // AP mode: just handle web server
  if (!configValid || WiFi.getMode() == WIFI_AP) {
    apServer.handleClient();
    MDNS.update();
    return;
  }

  // mDNS
  MDNS.update();

  // Handle physical button
  if (buttonPressed) {
    buttonPressed = false;
    unsigned long now = millis();
    if (now - lastDebounce > DEBOUNCE_DELAY) {
      lastDebounce = now;
      bool newState = !relayState;
      setRelay(newState);
      publishState(0, newState);
      Serial.printf("[Button] Toggled → %s\n", newState ? "ON" : "OFF");
    }
  }

  // WiFi reconnect
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastReconnect > RECONNECT_INTERVAL) {
      lastReconnect = now;
      Serial.println("[WiFi] Reconnecting...");
      WiFi.reconnect();
    }
    return;  // Don't do MQTT work without WiFi
  }

  // MQTT reconnect
  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastReconnect > RECONNECT_INTERVAL) {
      lastReconnect = now;
      Serial.println("[MQTT] Reconnecting...");
      mqttConnect();
    }
    return;
  }

  mqttClient.loop();

  // Heartbeat
  unsigned long now = millis();
  if (now - lastHeartbeat > HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    publishHeartbeat();
  }
}