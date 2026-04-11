import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_datasource.dart';
import '../datasources/hub_rest_datasource.dart';

class AuthRepositoryImpl implements AuthRepository {
  final AuthDatasource authDatasource;
  final HubRestDatasource restDatasource;
  final FlutterSecureStorage secureStorage;

  AuthRepositoryImpl({
    required this.authDatasource,
    required this.restDatasource,
    required this.secureStorage,
  });

  @override
  Future<void> signInWithGoogle() async {
    final idToken = await authDatasource.getGoogleIdToken();
    if (idToken != null) {
      final response = await restDatasource.signInWithGoogle(idToken);
      await secureStorage.write(key: 'jwt_token', value: response.token);
    }
  }

  @override
  Future<String?> getToken() async {
    return await secureStorage.read(key: 'jwt_token');
  }

  @override
  Future<void> signOut() async {
    await secureStorage.delete(key: 'jwt_token');
    await authDatasource.signOut();
  }
}
