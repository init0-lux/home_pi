import '../entities/device.dart';

abstract class DeviceRepository {
  Future<List<Device>> getDevices();
  Future<List<Device>> getDevicesByRoom(String roomId);
  Future<void> toggleDevice(String deviceId, {required String state});
}
