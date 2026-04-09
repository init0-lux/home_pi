import 'package:freezed_annotation/freezed_annotation.dart';

part 'heartbeat_payload.freezed.dart';
part 'heartbeat_payload.g.dart';

@freezed
class HeartbeatPayload with _$HeartbeatPayload {
  const factory HeartbeatPayload({
    required String deviceId,
    required String status,
    required int timestamp,
  }) = _HeartbeatPayload;

  factory HeartbeatPayload.fromJson(Map<String, dynamic> json) => _$HeartbeatPayloadFromJson(json);
}
