import 'package:google_sign_in/google_sign_in.dart';
import '../../core/error/exceptions.dart';

class AuthDatasource {
  final GoogleSignIn _googleSignIn = GoogleSignIn(scopes: ['email']);

  Future<String?> getGoogleIdToken() async {
    try {
      final GoogleSignInAccount? account = await _googleSignIn.signIn();
      if (account == null) {
        throw AuthException('Google Sign-In canceled by user');
      }
      
      final GoogleSignInAuthentication auth = await account.authentication;
      final String? idToken = auth.idToken;
      
      if (idToken == null) {
        throw AuthException('Failed to retrieve ID token from Google');
      }
      return idToken;
    } catch (e) {
      throw AuthException(e.toString());
    }
  }

  Future<void> signOut() async {
    await _googleSignIn.signOut();
  }
}
