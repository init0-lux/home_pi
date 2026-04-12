import '../repositories/provisioning_repository.dart';

class ProvisionDevice {
  final ProvisioningRepository repository;

  ProvisionDevice({required this.repository});

  Future<void> _step1_connect(String ssid, String password) async {
    await repository.initializaSoftApConnection(ssid, password);
  }

  Future<void> _step2_push(String netSsid, String netPass) async {
    await repository.pushCreditsToDevice(netSsid, netPass);
  }

  Future<void> _step3_verify(String deviceId) async {
    await repository.verifyProvisioningAndRegister(deviceId);
  }

  // Wrapper for use case execution inside provider
  Future<void> executeFullFlow(
    String deviceSsid, 
    String devicePass, 
    String homeSsid, 
    String homePass, 
    String finalDeviceId
  ) async {
    await _step1_connect(deviceSsid, devicePass);
    await _step2_push(homeSsid, homePass);
    await _step3_verify(finalDeviceId);
  }
}
