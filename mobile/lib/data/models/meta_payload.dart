import 'package:freezed_annotation/freezed_annotation.dart';

part 'meta_payload.freezed.dart';
part 'meta_payload.g.dart';

@freezed
class MetaPayload with _$MetaPayload {
  const factory MetaPayload({
    required String deviceId,
    required String roomId,
    required String type,
    required List<String> capabilities,
    required String firmwareVersion,
  }) = _MetaPayload;

  factory MetaPayload.fromJson(Map<String, dynamic> json) => _$MetaPayloadFromJson(json);
}
