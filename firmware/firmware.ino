#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <EEPROM.h>
#include <ArduinoJson.h>

// WiFi Configuration
const char* ssid = "oppo iphone 9";
const char* password = "projectpi";

// MQTT Configuration
const char* mqtt_server = "192.168.1.22"; // Change to Pi's IP
const int mqtt_port = 1883;

// Pin Mapping
const int relayPins[] = {D1, D2, D5, D6};
const int switchPin = D7; // GPIO13 (Button 1)
const int switchPin2 = D3; // Button 2
const int led1Pin = D0;
const int led2Pin = D4;
const int numAppliances = 4;

// State Variables
bool relayState[4];
bool lastSwitchLevel;
bool lastSwitchLevel2;
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 50;
unsigned long lastHeartbeat = 0;

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);
  EEPROM.begin(4);

  // Initialize Pins
  for (int i = 0; i < numAppliances; i++) {
    pinMode(relayPins[i], OUTPUT);
    
    // Load state from EEPROM
    relayState[i] = (EEPROM.read(i) == 1);
  }

  // Switch Setup
  pinMode(switchPin, INPUT_PULLUP);
  pinMode(switchPin2, INPUT_PULLUP);
  pinMode(led1Pin, OUTPUT);
  pinMode(led2Pin, OUTPUT);

  lastSwitchLevel = digitalRead(switchPin);
  lastSwitchLevel2 = digitalRead(switchPin2);
  
  // Apply Initial States
  for (int i = 0; i < numAppliances; i++) {
    applyRelayGPIO(i);
    // Explicitly sync LEDs for Relay 0 and 1
    if (i == 0) digitalWrite(led1Pin, relayState[0] ? HIGH : LOW);
    if (i == 1) digitalWrite(led2Pin, relayState[1] ? HIGH : LOW);
  }

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void setup_wifi() {
  delay(10);
  Serial.print("Connecting to ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
}

// Unified State Handler (MANDATORY)
void handleStateChange(uint8_t id, bool newState) {
  if (id >= numAppliances) return;
  if (relayState[id] == newState) return;

  relayState[id] = newState;
  applyRelayGPIO(id);
  
  // LED Status Feedback
  if (id == 0) digitalWrite(led1Pin, relayState[0] ? HIGH : LOW);
  if (id == 1) digitalWrite(led2Pin, relayState[1] ? HIGH : LOW);

  EEPROM.write(id, relayState[id] ? 1 : 0);
  EEPROM.commit();
  
  publishStatus(id);
}

void applyRelayGPIO(uint8_t id) {
  // ACTIVE LOW logic: true (ON) means LOW, false (OFF) means HIGH
  digitalWrite(relayPins[id], relayState[id] ? LOW : HIGH);
}

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) return;
  
  int state = doc["state"];
  
  String topicStr = String(topic);
  // home/appliance/1/set -> Extract '1'
  int applianceId = topicStr.substring(15, topicStr.indexOf('/', 15)).toInt();
  
  if (applianceId >= 1 && applianceId <= numAppliances) {
    handleStateChange(applianceId - 1, state == 1);
  }
}

void publishStatus(uint8_t index) {
  char topic[50];
  sprintf(topic, "home/appliance/%d/status", index + 1);
  
  StaticJsonDocument<100> doc;
  doc["state"] = relayState[index] ? 1 : 0;
  doc["updated_at"] = 0; 
  
  char buffer[100];
  serializeJson(doc, buffer);
  client.publish(topic, buffer);
}

void publishNodeStatus() {
  StaticJsonDocument<50> doc;
  doc["online"] = true;
  char buffer[50];
  serializeJson(doc, buffer);
  client.publish("home/node/status", buffer);
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("ESP8266Client")) {
      Serial.println("connected");
      client.subscribe("home/appliance/+/set");
      // Publish initial state for all
      for (int i = 0; i < numAppliances; i++) publishStatus(i);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 2 seconds");
      
      // Edge detection polling during reconnect (Non-blocking)
      unsigned long start = millis();
      while(millis() - start < 2000) {
        checkSwitchEdge();
        yield();
      }
    }
  }
}

void checkSwitchEdge() {
  unsigned long currentTime = millis();
  
  // Button 1 logic
  bool currentLevel = digitalRead(switchPin);
  if (currentLevel != lastSwitchLevel) {
    if (currentTime - lastDebounceTime > debounceDelay) {
      lastDebounceTime = currentTime;
      lastSwitchLevel = currentLevel;

      if (currentLevel == LOW) { // Pressed
        handleStateChange(0, !relayState[0]);
      }
    }
  }

  // Button 2 logic
  bool currentLevel2 = digitalRead(switchPin2);
  if (currentLevel2 != lastSwitchLevel2) {
    if (currentTime - lastDebounceTime > debounceDelay) {
      lastDebounceTime = currentTime;
      lastSwitchLevel2 = currentLevel2;

      if (currentLevel2 == LOW) { // Pressed
        handleStateChange(1, !relayState[1]);
      }
    }
  }
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  checkSwitchEdge();

  // Heartbeat every 5 seconds
  if (millis() - lastHeartbeat > 5000) {
    publishNodeStatus();
    lastHeartbeat = millis();
  }
}
