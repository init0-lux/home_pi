abstract class Failure {
  final String message;
  const Failure(this.message);
}

class ServerFailure extends Failure {
  const ServerFailure([super.message = "Server Error"]);
}

class NetworkFailure extends Failure {
  const NetworkFailure([super.message = "Network Error"]);
}

class CacheFailure extends Failure {
  const CacheFailure([super.message = "Cache Error"]);
}

class AuthFailure extends Failure {
  const AuthFailure([super.message = "Authentication Failed"]);
}

class DiscoveryFailure extends Failure {
  const DiscoveryFailure([super.message = "Hub Not Found"]);
}

class ProvisioningFailure extends Failure {
  const ProvisioningFailure([super.message = "Provisioning Failed"]);
}
