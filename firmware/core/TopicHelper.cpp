#include "TopicHelper.h"

namespace zapp {

String logicalDeviceId(const DeviceConfig& config, uint8_t channel) {
  return toString(config.baseDeviceId) + "-ch" + String(channel + 1);
}

String nodeCommandTopic(const DeviceConfig& config) {
  return "home/" + toString(config.roomId) + "/" + toString(config.baseDeviceId) +
         "/set";
}

String setTopic(const DeviceConfig& config, uint8_t channel) {
  return "home/" + toString(config.roomId) + "/" + logicalDeviceId(config, channel) +
         "/set";
}

String stateTopic(const DeviceConfig& config, uint8_t channel) {
  return "home/" + toString(config.roomId) + "/" + logicalDeviceId(config, channel) +
         "/state";
}

String heartbeatTopic(const DeviceConfig& config, uint8_t channel) {
  return "home/" + logicalDeviceId(config, channel) + "/heartbeat";
}

String metaTopic(const DeviceConfig& config, uint8_t channel) {
  return "home/" + logicalDeviceId(config, channel) + "/meta";
}

String legacySetTopic(uint8_t channel) {
  return "home/appliance/" + String(channel + 1) + "/set";
}

}  // namespace zapp
