#include "ProvisioningServer.h"

#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <cstring>

namespace zapp {

ProvisioningServer::ProvisioningServer() : server_(80), onSave_(nullptr), active_(false) {
  memset(&workingCopy_, 0, sizeof(workingCopy_));
}

void ProvisioningServer::begin(const String& apSsid, const DeviceConfig& baseConfig,
                               SaveHandler onSave) {
  workingCopy_ = baseConfig;
  onSave_ = onSave;

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apSsid.c_str());

  server_.on("/", HTTP_GET, [this]() { handleRoot(); });
  server_.on("/configure", HTTP_POST, [this]() { handleConfigure(); });
  server_.begin();
  active_ = true;
}

void ProvisioningServer::loop() {
  if (!active_) {
    return;
  }

  server_.handleClient();
}

bool ProvisioningServer::isActive() const {
  return active_;
}

void ProvisioningServer::stop() {
  if (!active_) {
    return;
  }

  server_.stop();
  WiFi.softAPdisconnect(true);
  active_ = false;
}

void ProvisioningServer::handleRoot() {
  static const char kHtml[] PROGMEM =
      "<!doctype html><html><body><h1>Zapp Provisioning</h1>"
      "<p>POST JSON to /configure with ssid, password, roomId, deviceId, and optional "
      "hubIp/propertyId.</p></body></html>";
  server_.send(200, "text/html", FPSTR(kHtml));
}

void ProvisioningServer::handleConfigure() {
  if (!server_.hasArg("plain")) {
    server_.send(400, "application/json", "{\"error\":\"missing_body\"}");
    return;
  }

  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, server_.arg("plain"));
  if (error) {
    server_.send(400, "application/json", "{\"error\":\"invalid_json\"}");
    return;
  }

  const String ssid = doc["ssid"] | "";
  const String password = doc["password"] | "";
  const String roomId = doc["roomId"] | "";
  const String deviceId = doc["deviceId"] | "";
  const String hubIp = doc["hubIp"] | "";
  const String propertyId = doc["propertyId"] | "";

  if (ssid.isEmpty() || roomId.isEmpty() || deviceId.isEmpty()) {
    server_.send(400, "application/json", "{\"error\":\"missing_fields\"}");
    return;
  }

  if (!copyString(workingCopy_.wifiSsid, sizeof(workingCopy_.wifiSsid), ssid) ||
      !copyString(workingCopy_.wifiPassword, sizeof(workingCopy_.wifiPassword),
                  password) ||
      !copyString(workingCopy_.roomId, sizeof(workingCopy_.roomId), roomId) ||
      !copyString(workingCopy_.baseDeviceId, sizeof(workingCopy_.baseDeviceId),
                  deviceId) ||
      !copyString(workingCopy_.hubIp, sizeof(workingCopy_.hubIp), hubIp) ||
      !copyString(workingCopy_.propertyId, sizeof(workingCopy_.propertyId),
                  propertyId)) {
    server_.send(400, "application/json", "{\"error\":\"field_too_long\"}");
    return;
  }

  server_.send(200, "application/json", "{\"status\":\"saved\"}");

  if (onSave_ != nullptr) {
    onSave_(workingCopy_);
  }
}

}  // namespace zapp
