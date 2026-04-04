#pragma once

#include <ESP8266WebServer.h>

#include "../core/ConfigStore.h"

namespace zapp {

class ProvisioningServer {
 public:
  using SaveHandler = void (*)(const DeviceConfig&);

  ProvisioningServer();

  void begin(const String& apSsid, const DeviceConfig& baseConfig, SaveHandler onSave);
  void loop();
  bool isActive() const;
  void stop();

 private:
  void handleRoot();
  void handleConfigure();

  ESP8266WebServer server_;
  SaveHandler onSave_;
  DeviceConfig workingCopy_;
  bool active_;
};

}  // namespace zapp
