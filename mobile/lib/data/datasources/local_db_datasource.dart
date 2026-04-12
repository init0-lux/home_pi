import 'package:isar/isar.dart';
import '../../domain/entities/device.dart';
import '../../domain/entities/room.dart';
import '../../domain/entities/chat_message.dart';

// Since Isar requires generated collections based on plain objects without Freezed,
// we create parallel Isar collections and map them if needed, or assume Freezed generated
// Isar-compatible classes if @Collection is configured.
// For the sake of this scaffold, we provide a placeholder wrapper outlining the methods.

class LocalDbDatasource {
  late Future<Isar> _isar;

  LocalDbDatasource() {
    // In real implementation: _isar = Isar.open([DeviceSchema, RoomSchema, ChatMessageSchema]);
  }

  Future<void> saveRooms(List<Room> rooms) async {
    final isar = await _isar;
    // isar.writeTxn(() async { await isar.rooms.putAll(roomsMapped); });
  }

  Future<List<Room>> getCachedRooms() async {
    // return await (await _isar).rooms.where().findAll();
    return [];
  }

  Future<void> saveDevices(List<Device> devices) async {
    final isar = await _isar;
    // isar.writeTxn(() async { await isar.devices.putAll(devicesMapped); });
  }

  Future<List<Device>> getCachedDevices() async {
    // return await (await _isar).devices.where().findAll();
    return [];
  }

  Future<void> saveChatMessage(ChatMessage message) async {
    final isar = await _isar;
    // isar.writeTxn(() async { await isar.chatMessages.put(messageMapped); });
  }

  Future<List<ChatMessage>> getCachedChatHistory() async {
    // return await (await _isar).chatMessages.where().sortByTimestamp().findAll();
    return [];
  }

  Future<void> clearChatHistory() async {
    final isar = await _isar;
    // isar.writeTxn(() async { await isar.chatMessages.clear(); });
  }
}
