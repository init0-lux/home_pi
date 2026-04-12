import '../../domain/repositories/provisioning_repository.dart';
import '../datasources/wifi_provision_datasource.dart';
import '../datasources/hub_rest_datasource.dart';

class ProvisioningRepositoryImpl implements ProvisioningRepository {
  final WifiProvisionDatasource wifiDs;
  final HubRestDatasource hubDs;

  ProvisioningRepositoryImpl({required this.wifiDs, required this.hubDs});

  @override
  Future<void> initializaSoftApConnection(String ssid, String password) async {
    await wifiDs.connectToAp(ssid, password);
  }

  @override
  Future<void> pushCreditsToDevice(String networkSsid, String networkPassword) async {
    await wifiDs.sendCredentialsToDevice('192.168.4.1', networkSsid, networkPassword);
  }

  @override
  Future<void> verifyProvisioningAndRegister(String deviceId) async {
    await wifiDs.disconnectFromAp();
    await hubDs.registerProvisionedDevice({'deviceId': deviceId});
  }
}
