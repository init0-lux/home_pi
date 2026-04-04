#pragma once

#include <Arduino.h>

namespace zapp {

class IrController {
 public:
  void begin() {}

  bool sendCommand(const String& command) {
    if (command != "AC_ON" && command != "AC_OFF") {
      return false;
    }

    // Hook IRremoteESP8266 signal playback here when the hardware is present.
    Serial.printf("IR command requested: %s\n", command.c_str());
    return true;
  }
};

}  // namespace zapp
