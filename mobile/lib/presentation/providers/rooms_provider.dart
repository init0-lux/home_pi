import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/room.dart';
import '../../domain/usecases/get_rooms.dart';

class RoomsNotifier extends StateNotifier<AsyncValue<List<Room>>> {
  final GetRooms _getRooms;

  RoomsNotifier(this._getRooms) : super(const AsyncValue.loading()) {
    fetchRooms();
  }

  Future<void> fetchRooms() async {
    state = const AsyncValue.loading();
    try {
      final rooms = await _getRooms.call();
      state = AsyncValue.data(rooms);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }
}

// Scaffolded provider
final roomsProvider = StateNotifierProvider<RoomsNotifier, AsyncValue<List<Room>>>((ref) {
  throw UnimplementedError();
});
