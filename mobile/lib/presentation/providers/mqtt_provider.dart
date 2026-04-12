import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/datasources/mqtt_datasource.dart';
import '../../providers/hub_connection_provider.dart';

class MqttNotifier extends StateNotifier<bool> {
  final MqttDatasource _mqttDatasource;
  final HubConnectionNotifier _hubConnectionNotifier;

  MqttNotifier(this._mqttDatasource, this._hubConnectionNotifier) : super(false);

  Future<void> connect(String ip) async {
    try {
      // Extract IP from format http://ip:port
      final uri = Uri.parse(ip);
      await _mqttDatasource.connect(uri.host, 1883);
      state = true;
    } catch (e) {
      state = false;
      _hubConnectionNotifier.setDegraded();
      _attemptReconnect(ip);
    }
  }

  void _attemptReconnect(String ip) {
    Future.delayed(const Duration(seconds: 5), () {
      if (!state) {
        connect(ip);
      }
    });
  }

  Stream<String> get messages => _mqttDatasource.messages;

  void disconnect() {
    _mqttDatasource.disconnect();
    state = false;
  }
}

// Scaffolded provider
final mqttProvider = StateNotifierProvider<MqttNotifier, bool>((ref) {
  throw UnimplementedError();
});
