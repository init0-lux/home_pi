import '../../domain/entities/room.dart';
import '../../domain/repositories/room_repository.dart';
import '../datasources/hub_rest_datasource.dart';
import '../datasources/local_db_datasource.dart';

class RoomRepositoryImpl implements RoomRepository {
  final HubRestDatasource restDatasource;
  final LocalDbDatasource localDbDatasource;

  RoomRepositoryImpl({
    required this.restDatasource,
    required this.localDbDatasource,
  });

  @override
  Future<List<Room>> getRooms() async {
    try {
      final rooms = await restDatasource.getRooms();
      await localDbDatasource.saveRooms(rooms);
      return rooms;
    } catch (e) {
      final cached = await localDbDatasource.getCachedRooms();
      if (cached.isNotEmpty) return cached;
      throw e; // Rethrow if no cache
    }
  }

  @override
  Future<Room> getRoom(String roomId) async {
    try {
      final room = await restDatasource.getRoom(roomId);
      // In a real app we'd update this specific room in cache too
      return room;
    } catch (e) {
      final cached = await localDbDatasource.getCachedRooms();
      final room = cached.where((r) => r.roomId == roomId).firstOrNull;
      if (room != null) return room;
      throw e;
    }
  }
}
