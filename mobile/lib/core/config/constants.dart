class AppConstants {
  // Discovery
  static const String mdnsServiceType = '_zapp._tcp';
  static const Duration discoveryTimeout = Duration(seconds: 10);
  
  // REST API Paths
  static const String healthPath = '/health';
  static const String authGooglePath = '/auth/google';
  static const String devicesPath = '/devices';
  static const String roomsPath = '/rooms';
  static const String provisionPath = '/provision';
  static const String mcpQueryPath = '/mcp/query';

  // Network timeouts
  static const Duration connectionTimeout = Duration(seconds: 5);
  static const Duration receiveTimeout = Duration(seconds: 5);

  // MQTT Topics Prefix
  static const String mqttTopicPrefix = 'home';
  static const String mqttStateSuffix = 'state';
  static const String mqttHeartbeatSuffix = 'heartbeat';
  static const String mqttMetaSuffix = 'meta';

  // MQTT Settings
  static const Duration mqttReconnectPeriod = Duration(seconds: 1);
  static const int mqttMaxWaitSeconds = 30;

  // Provisioning
  static const String provisionDevicePrefix = 'ZappDevice-';
  static const String provisionDefaultIP = '192.168.4.1';
  
  // Offline
  static const Duration deviceOfflineThreshold = Duration(seconds: 30);
}
