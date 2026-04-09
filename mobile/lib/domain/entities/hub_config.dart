import 'package:freezed_annotation/freezed_annotation.dart';

part 'hub_config.freezed.dart';
part 'hub_config.g.dart';

@freezed
class HubConfig with _$HubConfig {
  const factory HubConfig({
    required String ip,
    required int port,
    @Default('Unknown') String status,
  }) = _HubConfig;

  factory HubConfig.fromJson(Map<String, dynamic> json) => _$HubConfigFromJson(json);
}
