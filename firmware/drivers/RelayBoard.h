#pragma once

#include <Arduino.h>

#include "../core/ConfigStore.h"

namespace zapp {

class RelayBoard {
 public:
  void begin(const uint8_t persistedStates[CHANNEL_COUNT]);
  void setState(uint8_t channel, bool on);
  bool getState(uint8_t channel) const;
  bool consumeButtonPress(uint8_t& channel);

 private:
  static void IRAM_ATTR onButton0();
  static void IRAM_ATTR onButton1();
  static void IRAM_ATTR onButton2();
  static void IRAM_ATTR onButton3();
  void IRAM_ATTR markButtonPress(uint8_t channel);

  static RelayBoard* instance_;

  const uint8_t relayPins_[CHANNEL_COUNT] = {5, 4, 14, 12};
  const uint8_t buttonPins_[CHANNEL_COUNT] = {13, 0, 15, 3};
  bool states_[CHANNEL_COUNT] = {false, false, false, false};
  volatile bool pendingPress_[CHANNEL_COUNT] = {false, false, false, false};
  volatile uint32_t interruptMicros_[CHANNEL_COUNT] = {0, 0, 0, 0};
  uint32_t lastHandledMs_[CHANNEL_COUNT] = {0, 0, 0, 0};
};

}  // namespace zapp
