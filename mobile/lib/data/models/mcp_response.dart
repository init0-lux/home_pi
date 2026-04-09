import 'package:freezed_annotation/freezed_annotation.dart';

part 'mcp_response.freezed.dart';
part 'mcp_response.g.dart';

@freezed
class McpResponse with _$McpResponse {
  const factory McpResponse({
    required String response,
  }) = _McpResponse;

  factory McpResponse.fromJson(Map<String, dynamic> json) => _$McpResponseFromJson(json);
}
