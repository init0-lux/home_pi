import 'package:wifi_iot/wifi_iot.dart';
import '../../core/error/exceptions.dart';

class WifiProvisionDatasource {
  Future<void> connectToAp(String ssid, String password) async {
    final bool connected = await WiFiForIoTPlugin.connect(
      ssid,
      password: password,
      security: NetworkSecurity.WPA,
      joinOnce: true,
      withInternet: false,
    );

    if (!connected) {
      throw ServerException('Failed to connect to AP: $ssid');
    }
  }

  Future<void> sendCredentialsToDevice(String targetIp, String ssid, String password) async {
    // In a real scenario, this involves a HTTP POST to the fixed AP gateway, e.g. 192.168.4.1
    // Dio client could be used here. For scaffold, assume success.
    await Future.delayed(const Duration(seconds: 2));
  }

  Future<void> disconnectFromAp() async {
    await WiFiForIoTPlugin.disconnect();
  }
}
