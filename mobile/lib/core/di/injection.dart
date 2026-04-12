import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../network/auth_interceptor.dart';
import '../network/error_interceptor.dart';
import '../network/dio_client.dart';
import '../../data/datasources/auth_datasource.dart';
import '../../data/datasources/hub_rest_datasource.dart';
import '../../data/datasources/local_db_datasource.dart';
import '../../data/datasources/mdns_datasource.dart';
import '../../data/datasources/mqtt_datasource.dart';
import '../../data/datasources/wifi_provision_datasource.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../data/repositories/chat_repository_impl.dart';
import '../../data/repositories/device_repository_impl.dart';
import '../../data/repositories/provisioning_repository_impl.dart';
import '../../data/repositories/room_repository_impl.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/repositories/chat_repository.dart';
import '../../domain/repositories/device_repository.dart';
import '../../domain/repositories/provisioning_repository.dart';
import '../../domain/repositories/room_repository.dart';
import '../../domain/usecases/discover_hub.dart';
import '../../domain/usecases/get_devices.dart';
import '../../domain/usecases/get_rooms.dart';
import '../../domain/usecases/provision_device.dart';
import '../../domain/usecases/send_chat_message.dart';
import '../../domain/usecases/sign_in.dart';
import '../../domain/usecases/sign_out.dart';
import '../../domain/usecases/toggle_device.dart';

// -- Core & Network --
final secureStorageProvider = Provider((ref) => const FlutterSecureStorage());

final authInterceptorProvider = Provider((ref) => AuthInterceptor(ref.watch(secureStorageProvider)));
final errorInterceptorProvider = Provider((ref) => ErrorInterceptor());

final dioClientProvider = Provider((ref) => DioClient(
  authInterceptor: ref.watch(authInterceptorProvider),
  errorInterceptor: ref.watch(errorInterceptorProvider),
));

// -- Datasources --
final authDatasourceProvider = Provider((ref) => AuthDatasource());
final hubRestDatasourceProvider = Provider((ref) => HubRestDatasource(ref.watch(dioClientProvider).dio));
final localDbDatasourceProvider = Provider((ref) => LocalDbDatasource());
final mdnsDatasourceProvider = Provider((ref) => MdnsDatasource());
final mqttDatasourceProvider = Provider((ref) => MqttDatasource());
final wifiProvisionDatasourceProvider = Provider((ref) => WifiProvisionDatasource());

// -- Repositories --
final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepositoryImpl(
  authDatasource: ref.watch(authDatasourceProvider),
  restDatasource: ref.watch(hubRestDatasourceProvider),
  secureStorage: ref.watch(secureStorageProvider),
));

final chatRepositoryProvider = Provider<ChatRepository>((ref) => ChatRepositoryImpl(
  restDatasource: ref.watch(hubRestDatasourceProvider),
  localDbDatasource: ref.watch(localDbDatasourceProvider),
));

final deviceRepositoryProvider = Provider<DeviceRepository>((ref) => DeviceRepositoryImpl(
  restDatasource: ref.watch(hubRestDatasourceProvider),
  localDbDatasource: ref.watch(localDbDatasourceProvider),
));

final provisioningRepositoryProvider = Provider<ProvisioningRepository>((ref) => ProvisioningRepositoryImpl(
  wifiDs: ref.watch(wifiProvisionDatasourceProvider),
  hubDs: ref.watch(hubRestDatasourceProvider),
));

final roomRepositoryProvider = Provider<RoomRepository>((ref) => RoomRepositoryImpl(
  restDatasource: ref.watch(hubRestDatasourceProvider),
  localDbDatasource: ref.watch(localDbDatasourceProvider),
));

// -- UseCases --
// Note: discover_hub originally wrapped a HubRepository but we can just use the datasource here 
// for simplicity given our current scaffolding mapping.
final discoverHubProvider = Provider((ref) => MdnsDatasource()); // Mapped directly for now

final getDevicesProvider = Provider((ref) => GetDevices(ref.watch(deviceRepositoryProvider)));
final getRoomsProvider = Provider((ref) => GetRooms(ref.watch(roomRepositoryProvider)));
final provisionDeviceProvider = Provider((ref) => ProvisionDevice(repository: ref.watch(provisioningRepositoryProvider)));
final sendChatMessageProvider = Provider((ref) => SendChatMessage(ref.watch(chatRepositoryProvider)));
final signInProvider = Provider((ref) => SignInWithGoogle(ref.watch(authRepositoryProvider)));
final signOutProvider = Provider((ref) => SignOut(ref.watch(authRepositoryProvider)));
final toggleDeviceProvider = Provider((ref) => ToggleDevice(ref.watch(deviceRepositoryProvider)));
