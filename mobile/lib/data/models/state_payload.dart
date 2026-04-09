import 'package:freezed_annotation/freezed_annotation.dart';

part 'state_payload.freezed.dart';
part 'state_payload.g.dart';

@freezed
class StatePayload with _$StatePayload {
  const factory StatePayload({
    required String deviceId,
    required String roomId,
    required String state,
    required int timestamp,
  }) = _StatePayload;

  factory StatePayload.fromJson(Map<String, dynamic> json) => _$StatePayloadFromJson(json);
}

@freezed
class StateSetPayload with _$StateSetPayload {
  const factory StateSetPayload({
    required String state,
  }) = _StateSetPayload;

  factory StateSetPayload.fromJson(Map<String, dynamic> json) => _$StateSetPayloadFromJson(json);
}
