#include "ConfigStore.h"

#include <cstring>

namespace zapp {

  namespace {

    template <typename T>
    void zeroMemory(T& value) {
      memset(&value, 0, sizeof(T));
    }

  }  // namespace

bool ConfigStore::begin() {
  EEPROM.begin(EEPROM_BYTES);
  return true;
}

  bool ConfigStore::load(DeviceConfig& config) {
    zeroMemory(config);
    EEPROM.get(0, config);

    if (config.magic != CONFIG_MAGIC || config.version != CONFIG_VERSION) {
      reset(config);
      return false;
    }

    config.wifiSsid[sizeof(config.wifiSsid) - 1] = '\0';
    config.wifiPassword[sizeof(config.wifiPassword) - 1] = '\0';
    config.roomId[sizeof(config.roomId) - 1] = '\0';
    config.baseDeviceId[sizeof(config.baseDeviceId) - 1] = '\0';
    config.hubIp[sizeof(config.hubIp) - 1] = '\0';
    config.propertyId[sizeof(config.propertyId) - 1] = '\0';

    return isProvisioned(config);
  }

  bool ConfigStore::save(const DeviceConfig& config) {
    EEPROM.put(0, config);
    return EEPROM.commit();
  }

  void ConfigStore::reset(DeviceConfig& config) {
    zeroMemory(config);
    config.magic = CONFIG_MAGIC;
    config.version = CONFIG_VERSION;
  }

  bool isProvisioned(const DeviceConfig& config) {
    return strlen(config.wifiSsid) > 0 && strlen(config.roomId) > 0 &&
          strlen(config.baseDeviceId) > 0;
  }

  bool copyString(char* destination, size_t destinationSize, const String& value) {
    if (destination == nullptr || destinationSize == 0 ||
        value.length() >= destinationSize) {
      return false;
    }

    value.toCharArray(destination, destinationSize);
    destination[destinationSize - 1] = '\0';
    return true;
  }

  String toString(const char* value) {
    return value == nullptr ? String() : String(value);
  }

}  // namespace zapp
