class ServerException implements Exception {
  final String message;
  ServerException([this.message = 'Server Exception']);
}

class CacheException implements Exception {
  final String message;
  CacheException([this.message = 'Cache Exception']);
}

class NetworkException implements Exception {
  final String message;
  NetworkException([this.message = 'Network Exception']);
}

class AuthException implements Exception {
  final String message;
  AuthException([this.message = 'Auth Exception']);
}

class ProvisioningException implements Exception {
  final String message;
  ProvisioningException([this.message = 'Provisioning Exception']);
}
