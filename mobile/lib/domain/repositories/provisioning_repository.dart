abstract class ProvisioningRepository {
  Future<List<String>> scanAPs();
  Future<void> connectToAP(String ssid);
  Future<void> configureDevice({
    required String ssid,
    required String password,
    required String roomId,
    required String deviceId,
  });
  Future<void> reconnectHome(String ssid);
}
