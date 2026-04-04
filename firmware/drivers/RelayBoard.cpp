#include "RelayBoard.h"

namespace zapp {

namespace {

constexpr uint32_t ISR_DEBOUNCE_US = 50000;
constexpr uint8_t RELAY_ON_LEVEL = HIGH;
constexpr uint8_t RELAY_OFF_LEVEL = LOW;

}  // namespace

RelayBoard* RelayBoard::instance_ = nullptr;

void RelayBoard::begin(const uint8_t persistedStates[CHANNEL_COUNT]) {
  instance_ = this;

  for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
    pinMode(relayPins_[channel], OUTPUT);
    pinMode(buttonPins_[channel], INPUT_PULLUP);
    setState(channel, persistedStates[channel] == 1);
  }

  attachInterrupt(digitalPinToInterrupt(buttonPins_[0]), onButton0, FALLING);
  attachInterrupt(digitalPinToInterrupt(buttonPins_[1]), onButton1, FALLING);
  attachInterrupt(digitalPinToInterrupt(buttonPins_[2]), onButton2, FALLING);
  attachInterrupt(digitalPinToInterrupt(buttonPins_[3]), onButton3, FALLING);
}

void RelayBoard::setState(uint8_t channel, bool on) {
  if (channel >= CHANNEL_COUNT) {
    return;
  }

  states_[channel] = on;
  digitalWrite(relayPins_[channel], on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}

bool RelayBoard::getState(uint8_t channel) const {
  if (channel >= CHANNEL_COUNT) {
    return false;
  }

  return states_[channel];
}

bool RelayBoard::consumeButtonPress(uint8_t& channel) {
  const uint32_t now = millis();

  for (uint8_t index = 0; index < CHANNEL_COUNT; ++index) {
    bool wasPending = false;

    noInterrupts();
    wasPending = pendingPress_[index];
    if (wasPending) {
      pendingPress_[index] = false;
    }
    interrupts();

    if (!wasPending) {
      continue;
    }

    if (now - lastHandledMs_[index] < 50) {
      continue;
    }

    if (digitalRead(buttonPins_[index]) == LOW) {
      lastHandledMs_[index] = now;
      channel = index;
      return true;
    }
  }

  return false;
}

void IRAM_ATTR RelayBoard::onButton0() {
  if (instance_ != nullptr) {
    instance_->markButtonPress(0);
  }
}

void IRAM_ATTR RelayBoard::onButton1() {
  if (instance_ != nullptr) {
    instance_->markButtonPress(1);
  }
}

void IRAM_ATTR RelayBoard::onButton2() {
  if (instance_ != nullptr) {
    instance_->markButtonPress(2);
  }
}

void IRAM_ATTR RelayBoard::onButton3() {
  if (instance_ != nullptr) {
    instance_->markButtonPress(3);
  }
}

void IRAM_ATTR RelayBoard::markButtonPress(uint8_t channel) {
  const uint32_t now = micros();
  if (now - interruptMicros_[channel] < ISR_DEBOUNCE_US) {
    return;
  }

  interruptMicros_[channel] = now;
  pendingPress_[channel] = true;
}

}  // namespace zapp
