abstract class AuthRepository {
  Future<void> signInWithGoogle();
  Future<String?> getToken();
  Future<void> signOut();
}
