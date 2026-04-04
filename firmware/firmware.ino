#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <ESP8266httpUpdate.h>
#include <ESP8266mDNS.h>
#include <PubSubClient.h>
#include <time.h>

#include "core/ConfigStore.h"
#include "core/TopicHelper.h"
#include "drivers/RelayBoard.h"
#include "modules/IrController.h"
#include "modules/ProvisioningServer.h"

namespace {

using zapp::CHANNEL_COUNT;
using zapp::ConfigStore;
using zapp::DeviceConfig;
using zapp::IrController;
using zapp::ProvisioningServer;
using zapp::RelayBoard;

constexpr char kFirmwareVersion[] = "1.0.0";
constexpr uint16_t kMqttPort = 1883;
constexpr uint32_t kHeartbeatIntervalMs = 10000;
constexpr uint32_t kWifiRetryIntervalMs = 10000;
constexpr uint32_t kMqttRetryIntervalMs = 5000;
constexpr uint8_t kWifiFailureThreshold = 6;

enum class DeviceState {
  BOOT,
  PROVISIONING,
  CONNECTING_WIFI,
  CONNECTING_MQTT,
  ACTIVE,
  ERROR,
};

ConfigStore gConfigStore;
DeviceConfig gConfig;
RelayBoard gRelayBoard;
ProvisioningServer gProvisioningServer;
IrController gIrController;
WiFiClient gWifiClient;
PubSubClient gMqttClient(gWifiClient);

DeviceState gState = DeviceState::BOOT;
bool gShouldReboot = false;
bool gWifiWasConnected = false;
bool gMdnsStarted = false;
uint8_t gWifiFailures = 0;
uint32_t gLastWifiAttemptMs = 0;
uint32_t gLastMqttAttemptMs = 0;
uint32_t gLastHeartbeatMs = 0;
String gPendingOtaUrl;
bool gHasEpochBase = false;
int32_t gEpochOffsetSeconds = 0;

String hostName() {
  return "zapp-" + String(ESP.getChipId(), HEX);
}

uint32_t currentEpochSeconds() {
  const time_t current = time(nullptr);
  if (current > 1700000000) {
    return static_cast<uint32_t>(current);
  }

  if (gHasEpochBase) {
    return static_cast<uint32_t>((millis() / 1000UL) + gEpochOffsetSeconds);
  }

  return millis() / 1000UL;
}

void updateEpochBase(const JsonDocument& doc) {
  if (!doc["timestamp"].is<uint32_t>()) {
    return;
  }

  const uint32_t timestamp = doc["timestamp"].as<uint32_t>();
  gEpochOffsetSeconds = static_cast<int32_t>(timestamp) -
                        static_cast<int32_t>(millis() / 1000UL);
  gHasEpochBase = true;
}

String onOff(bool state) {
  return state ? "ON" : "OFF";
}

void persistRelayStates() {
  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    gConfig.relayStates[channel] = gRelayBoard.getState(channel) ? 1 : 0;
  }
  gConfigStore.save(gConfig);
}

void publishState(uint8_t channel);

void publishMetadata(uint8_t channel) {
  DynamicJsonDocument doc(256);
  doc["deviceId"] = zapp::logicalDeviceId(gConfig, channel);
  doc["roomId"] = gConfig.roomId;
  doc["type"] = "light";
  JsonArray capabilities = doc.createNestedArray("capabilities");
  capabilities.add("on");
  capabilities.add("off");
  doc["firmwareVersion"] = kFirmwareVersion;

  String payload;
  serializeJson(doc, payload);
  gMqttClient.publish(zapp::metaTopic(gConfig, channel).c_str(), payload.c_str(), true);
}

void publishHeartbeat(uint8_t channel) {
  DynamicJsonDocument doc(192);
  doc["deviceId"] = zapp::logicalDeviceId(gConfig, channel);
  doc["status"] = "ONLINE";
  doc["timestamp"] = currentEpochSeconds();

  String payload;
  serializeJson(doc, payload);
  gMqttClient.publish(zapp::heartbeatTopic(gConfig, channel).c_str(), payload.c_str(),
                      false);
}

void publishState(uint8_t channel) {
  DynamicJsonDocument doc(192);
  doc["deviceId"] = zapp::logicalDeviceId(gConfig, channel);
  doc["roomId"] = gConfig.roomId;
  doc["state"] = onOff(gRelayBoard.getState(channel));
  doc["timestamp"] = currentEpochSeconds();

  String payload;
  serializeJson(doc, payload);
  gMqttClient.publish(zapp::stateTopic(gConfig, channel).c_str(), payload.c_str(), true);
}

void publishAllMetadata() {
  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    publishMetadata(channel);
  }
}

void publishAllStates() {
  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    publishState(channel);
  }
}

void publishAllHeartbeats() {
  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    publishHeartbeat(channel);
  }
}

void applyChannelState(uint8_t channel, bool state, bool publishUpdate) {
  gRelayBoard.setState(channel, state);
  persistRelayStates();

  if (publishUpdate && gMqttClient.connected()) {
    publishState(channel);
  }
}

void toggleChannel(uint8_t channel, bool publishUpdate) {
  applyChannelState(channel, !gRelayBoard.getState(channel), publishUpdate);
}

bool parseRequestedState(const JsonDocument& doc, bool& requestedState) {
  if (doc["state"].is<const char*>()) {
    const String state = String(doc["state"].as<const char*>());
    if (state.equalsIgnoreCase("ON")) {
      requestedState = true;
      return true;
    }
    if (state.equalsIgnoreCase("OFF")) {
      requestedState = false;
      return true;
    }
  }

  if (doc["state"].is<int>()) {
    requestedState = doc["state"].as<int>() != 0;
    return true;
  }

  return false;
}

void queueOtaIfPresent(const JsonDocument& doc) {
  if (doc["otaUrl"].is<const char*>()) {
    gPendingOtaUrl = String(doc["otaUrl"].as<const char*>());
  }
}

void handleNodeCommand(const JsonDocument& doc) {
  queueOtaIfPresent(doc);

  if (doc["irCommand"].is<const char*>()) {
    gIrController.sendCommand(String(doc["irCommand"].as<const char*>()));
  }

  if (doc["channel"].is<uint8_t>()) {
    const uint8_t oneBasedChannel = doc["channel"].as<uint8_t>();
    if (oneBasedChannel >= 1 && oneBasedChannel <= CHANNEL_COUNT) {
      bool requestedState = false;
      if (parseRequestedState(doc, requestedState)) {
        applyChannelState(oneBasedChannel - 1, requestedState, true);
      }
    }
  }

  if (doc["states"].is<JsonArrayConst>()) {
    const JsonArrayConst states = doc["states"].as<JsonArrayConst>();
    uint8_t channel = 0;
    for (JsonVariantConst item : states) {
      if (channel >= CHANNEL_COUNT) {
        break;
      }

      const bool state = item.is<const char*>()
                             ? String(item.as<const char*>()).equalsIgnoreCase("ON")
                             : item.as<int>() != 0;
      applyChannelState(channel, state, true);
      ++channel;
    }
  }
}

bool resolveHubAddress(IPAddress& hubAddress) {
  if (WiFi.hostByName("hub.local", hubAddress) == 1) {
    return true;
  }

  return hubAddress.fromString(gConfig.hubIp);
}

void subscribeTopics() {
  gMqttClient.subscribe(zapp::nodeCommandTopic(gConfig).c_str());

  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    gMqttClient.subscribe(zapp::setTopic(gConfig, channel).c_str());
    gMqttClient.subscribe(zapp::legacySetTopic(channel).c_str());
  }
}

void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
  DynamicJsonDocument doc(512);
  const auto error = deserializeJson(doc, payload, length);
  if (error) {
    return;
  }

  updateEpochBase(doc);
  const String incomingTopic(topic);

  if (incomingTopic == zapp::nodeCommandTopic(gConfig)) {
    handleNodeCommand(doc);
    return;
  }

  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    if (incomingTopic != zapp::setTopic(gConfig, channel) &&
        incomingTopic != zapp::legacySetTopic(channel)) {
      continue;
    }

    queueOtaIfPresent(doc);
    if (doc["irCommand"].is<const char*>()) {
      gIrController.sendCommand(String(doc["irCommand"].as<const char*>()));
    }

    bool requestedState = false;
    if (parseRequestedState(doc, requestedState)) {
      applyChannelState(channel, requestedState, true);
    }
    return;
  }
}

void onProvisioningSaved(const DeviceConfig& config) {
  gConfig = config;
  gConfig.magic = zapp::CONFIG_MAGIC;
  gConfig.version = zapp::CONFIG_VERSION;
  gConfigStore.save(gConfig);
  gShouldReboot = true;
}

void startProvisioningMode() {
  if (gProvisioningServer.isActive()) {
    return;
  }

  gState = DeviceState::PROVISIONING;
  gMqttClient.disconnect();
  WiFi.disconnect(true);
  delay(50);

  String apName = "Device-" + String(ESP.getChipId(), HEX);
  apName.toUpperCase();
  gProvisioningServer.begin(apName, gConfig, onProvisioningSaved);
}

void onWifiConnected() {
  gWifiFailures = 0;
  gState = DeviceState::CONNECTING_MQTT;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  if (!gMdnsStarted) {
    const String mdnsHostName = hostName();
    gMdnsStarted = MDNS.begin(mdnsHostName.c_str());
  }
}

void handleWifi() {
  if (gProvisioningServer.isActive()) {
    return;
  }

  if (!zapp::isProvisioned(gConfig)) {
    startProvisioningMode();
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!gWifiWasConnected) {
      gWifiWasConnected = true;
      onWifiConnected();
    }
    return;
  }

  if (gWifiWasConnected) {
    gWifiWasConnected = false;
    gMdnsStarted = false;
    gMqttClient.disconnect();
  }

  if (millis() - gLastWifiAttemptMs < kWifiRetryIntervalMs) {
    return;
  }

  gLastWifiAttemptMs = millis();
  ++gWifiFailures;

  if (gWifiFailures >= kWifiFailureThreshold) {
    startProvisioningMode();
    return;
  }

  gState = DeviceState::CONNECTING_WIFI;
  WiFi.mode(WIFI_STA);
  const String wifiHostName = hostName();
  WiFi.hostname(wifiHostName.c_str());
  WiFi.begin(gConfig.wifiSsid, gConfig.wifiPassword);
}

void handleMqtt() {
  if (gProvisioningServer.isActive() || WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (gMqttClient.connected()) {
    gMqttClient.loop();
    return;
  }

  if (millis() - gLastMqttAttemptMs < kMqttRetryIntervalMs) {
    return;
  }

  gLastMqttAttemptMs = millis();
  gState = DeviceState::CONNECTING_MQTT;

  IPAddress hubAddress;
  if (resolveHubAddress(hubAddress)) {
    gMqttClient.setServer(hubAddress, kMqttPort);
  } else {
    gMqttClient.setServer("hub.local", kMqttPort);
  }

  const String clientId = hostName() + "-" + String(ESP.getChipId(), HEX);
  if (!gMqttClient.connect(clientId.c_str())) {
    return;
  }

  subscribeTopics();
  publishAllMetadata();
  publishAllStates();
  publishAllHeartbeats();
  gLastHeartbeatMs = millis();
  gState = DeviceState::ACTIVE;
}

void handleButtons() {
  uint8_t channel = 0;
  while (gRelayBoard.consumeButtonPress(channel)) {
    toggleChannel(channel, gMqttClient.connected());
  }
}

void handleHeartbeat() {
  if (!gMqttClient.connected()) {
    return;
  }

  if (millis() - gLastHeartbeatMs < kHeartbeatIntervalMs) {
    return;
  }

  gLastHeartbeatMs = millis();
  publishAllHeartbeats();
}

void handleOta() {
  if (gPendingOtaUrl.isEmpty() || WiFi.status() != WL_CONNECTED) {
    return;
  }

  ESPhttpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return result = ESPhttpUpdate.update(gWifiClient, gPendingOtaUrl);
  if (result == HTTP_UPDATE_FAILED) {
    Serial.printf("OTA failed: %s\n", ESPhttpUpdate.getLastErrorString().c_str());
    gPendingOtaUrl = "";
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(50);

  gConfigStore.begin();
  gConfigStore.load(gConfig);

  gRelayBoard.begin(gConfig.relayStates);
  gIrController.begin();

  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);

  gMqttClient.setCallback(handleMqttMessage);
  gMqttClient.setBufferSize(512);

  if (!zapp::isProvisioned(gConfig)) {
    startProvisioningMode();
  }
}

void loop() {
  gProvisioningServer.loop();
  handleButtons();
  handleWifi();
  handleMqtt();
  handleHeartbeat();
  handleOta();

  if (gShouldReboot) {
    delay(200);
    ESP.restart();
  }

  delay(5);
}
