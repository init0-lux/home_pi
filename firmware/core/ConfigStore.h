#pragma once

#include <Arduino.h>
#include <EEPROM.h>

namespace zapp {

constexpr uint8_t CHANNEL_COUNT = 4;
constexpr uint16_t EEPROM_BYTES = 1024;
constexpr uint32_t CONFIG_MAGIC = 0x5A415050;
constexpr uint16_t CONFIG_VERSION = 1;

struct DeviceConfig {
  uint32_t magic;
  uint16_t version;
  char wifiSsid[33];
  char wifiPassword[65];
  char roomId[33];
  char baseDeviceId[37];
  char hubIp[16];
  char propertyId[33];
  uint8_t relayStates[CHANNEL_COUNT];
};

class ConfigStore {
 public:
  bool begin();
  bool load(DeviceConfig& config);
  bool save(const DeviceConfig& config);
  void reset(DeviceConfig& config);
};

bool isProvisioned(const DeviceConfig& config);
bool copyString(char* destination, size_t destinationSize, const String& value);
String toString(const char* value);

}  // namespace zapp
