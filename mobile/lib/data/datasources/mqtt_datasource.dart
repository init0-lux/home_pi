import 'dart:async';
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';
import '../../core/config/constants.dart';

class MqttDatasource {
  MqttServerClient? _client;
  
  // Expose messages stream
  final _messageController = StreamController<String>.broadcast();
  Stream<String> get messages => _messageController.stream;

  Future<void> connect(String ip, int port) async {
    _client = MqttServerClient.withPort(ip, 'zapp_app_${DateTime.now().millisecondsSinceEpoch}', port);
    _client!.logging(on: false);
    _client!.keepAlivePeriod = 20;
    _client!.onDisconnected = onDisconnected;
    _client!.onConnected = onConnected;
    _client!.onSubscribed = onSubscribed;

    final connMess = MqttConnectMessage()
        .withClientIdentifier('zapp_app_${DateTime.now().millisecondsSinceEpoch}')
        .withWillQos(MqttQos.atLeastOnce);
    
    _client!.connectionMessage = connMess;

    try {
      await _client!.connect();
    } catch (e) {
      _client!.disconnect();
      throw Exception('MQTT Connection Failed: $e');
    }

    if (_client!.connectionStatus!.state == MqttConnectionState.connected) {
      // Subscribe to topics
      _client!.subscribe('${AppConstants.mqttTopicPrefix}/+/+/${AppConstants.mqttStateSuffix}', MqttQos.atLeastOnce);
      _client!.subscribe('${AppConstants.mqttTopicPrefix}/+/${AppConstants.mqttHeartbeatSuffix}', MqttQos.atLeastOnce);
      _client!.subscribe('${AppConstants.mqttTopicPrefix}/+/${AppConstants.mqttMetaSuffix}', MqttQos.atLeastOnce);

      _client!.updates!.listen((List<MqttReceivedMessage<MqttMessage?>>? c) {
        final recMess = c![0].payload as MqttPublishMessage;
        final pt = MqttPublishPayload.bytesToStringAsString(recMess.payload.message);
        _messageController.add('${c[0].topic}|$pt');
      });
    }
  }

  void onConnected() {
    print('MQTT Connected');
  }

  void onDisconnected() {
    print('MQTT Disconnected');
    // Connection health and auto-reconnect handled by riverpod/states
  }

  void onSubscribed(String topic) {
    print('MQTT Subscribed topic: $topic');
  }

  void disconnect() {
    _client?.disconnect();
  }
}
