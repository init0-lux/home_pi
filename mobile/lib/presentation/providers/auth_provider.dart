import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/usecases/sign_in.dart';
import '../../domain/usecases/sign_out.dart';

enum AuthState {
  unauthenticated,
  loading,
  authenticated,
}

class AuthNotifier extends StateNotifier<AuthState> {
  final SignInWithGoogle _signInWithGoogle;
  final SignOut _signOut;

  AuthNotifier(this._signInWithGoogle, this._signOut) : super(AuthState.unauthenticated);

  Future<void> login() async {
    state = AuthState.loading;
    try {
      await _signInWithGoogle.call();
      state = AuthState.authenticated;
    } catch (e) {
      state = AuthState.unauthenticated;
    }
  }

  Future<void> logout() async {
    state = AuthState.loading;
    try {
      await _signOut.call();
    } finally {
      state = AuthState.unauthenticated;
    }
  }
}

// Scaffolded provider
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  throw UnimplementedError();
});
