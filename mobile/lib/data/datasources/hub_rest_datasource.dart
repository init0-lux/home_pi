import 'package:dio/dio.dart';
import '../../core/config/constants.dart';
import '../../domain/entities/device.dart';
import '../../domain/entities/room.dart';
import '../models/auth_response.dart';
import '../models/mcp_response.dart';

class HubRestDatasource {
  final Dio dio;

  HubRestDatasource(this.dio);

  Future<bool> checkHealth() async {
    final response = await dio.get(AppConstants.healthPath);
    return response.statusCode == 200;
  }

  Future<AuthResponse> signInWithGoogle(String idToken) async {
    final response = await dio.post(
      AppConstants.authGooglePath, 
      data: {'idToken': idToken},
    );
    return AuthResponse.fromJson(response.data);
  }

  Future<List<Device>> getDevices() async {
    final response = await dio.get(AppConstants.devicesPath);
    final List data = response.data;
    return data.map((json) => Device.fromJson(json)).toList();
  }

  Future<void> toggleDevice(String deviceId, String state) async {
    await dio.post(
      '${AppConstants.devicesPath}/$deviceId/action',
      data: {'state': state},
    );
  }

  Future<List<Room>> getRooms() async {
    final response = await dio.get(AppConstants.roomsPath);
    final List data = response.data;
    return data.map((json) => Room.fromJson(json)).toList();
  }

  Future<Room> getRoom(String roomId) async {
    final response = await dio.get('${AppConstants.roomsPath}/$roomId');
    return Room.fromJson(response.data);
  }

  Future<McpResponse> sendMcpQuery(String query) async {
    final response = await dio.post(
      AppConstants.mcpQueryPath,
      data: {'query': query},
    );
    return McpResponse.fromJson(response.data);
  }
  
  Future<void> registerProvisionedDevice(Map<String, dynamic> data) async {
    await dio.post(AppConstants.provisionPath, data: data);
  }
}
