import '../entities/room.dart';

abstract class RoomRepository {
  Future<List<Room>> getRooms();
  Future<Room> getRoom(String roomId);
}
