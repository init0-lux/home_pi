import '../../domain/entities/room.dart';
import '../repositories/room_repository.dart';

class GetRooms {
  final RoomRepository repository;

  GetRooms(this.repository);

  Future<List<Room>> call() async {
    return await repository.getRooms();
  }
}
