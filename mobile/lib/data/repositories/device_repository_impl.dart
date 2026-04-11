import '../../domain/entities/device.dart';
import '../../domain/repositories/device_repository.dart';
import '../datasources/hub_rest_datasource.dart';
import '../datasources/local_db_datasource.dart';

class DeviceRepositoryImpl implements DeviceRepository {
  final HubRestDatasource restDatasource;
  final LocalDbDatasource localDbDatasource;

  DeviceRepositoryImpl({
    required this.restDatasource,
    required this.localDbDatasource,
  });

  @override
  Future<List<Device>> getDevices() async {
    try {
      final devices = await restDatasource.getDevices();
      await localDbDatasource.saveDevices(devices);
      return devices;
    } catch (e) {
      final cached = await localDbDatasource.getCachedDevices();
      if (cached.isNotEmpty) return cached;
      throw e;
    }
  }

  @override
  Future<List<Device>> getDevicesByRoom(String roomId) async {
    final allDevices = await getDevices();
    return allDevices.where((d) => d.roomId == roomId).toList();
  }

  @override
  Future<void> toggleDevice(String deviceId, {required String state}) async {
    await restDatasource.toggleDevice(deviceId, state);
  }
}
