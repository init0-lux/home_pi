#pragma once

#include <Arduino.h>

#include "ConfigStore.h"

namespace zapp {

String logicalDeviceId(const DeviceConfig& config, uint8_t channel);
String nodeCommandTopic(const DeviceConfig& config);
String setTopic(const DeviceConfig& config, uint8_t channel);
String stateTopic(const DeviceConfig& config, uint8_t channel);
String heartbeatTopic(const DeviceConfig& config, uint8_t channel);
String metaTopic(const DeviceConfig& config, uint8_t channel);
String legacySetTopic(uint8_t channel);

}  // namespace zapp
