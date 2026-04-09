import 'package:freezed_annotation/freezed_annotation.dart';
import 'device.dart';

part 'room.freezed.dart';
part 'room.g.dart';

@freezed
class Room with _$Room {
  const factory Room({
    required String roomId,
    @Default([]) List<Device> devices,
  }) = _Room;

  factory Room.fromJson(Map<String, dynamic> json) => _$RoomFromJson(json);
}
