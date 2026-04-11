import '../repositories/device_repository.dart';

class ToggleDevice {
  final DeviceRepository repository;

  ToggleDevice(this.repository);

  Future<void> call(String deviceId, String state) async {
    return await repository.toggleDevice(deviceId, state: state);
  }
}
