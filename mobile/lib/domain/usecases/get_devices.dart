import '../../domain/entities/device.dart';
import '../repositories/device_repository.dart';

class GetDevices {
  final DeviceRepository repository;

  GetDevices(this.repository);

  Future<List<Device>> call() async {
    return await repository.getDevices();
  }

  Future<List<Device>> byRoom(String roomId) async {
    return await repository.getDevicesByRoom(roomId);
  }
}
