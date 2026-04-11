import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/auth_provider.dart';

class LoginScreen extends ConsumerWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    ref.listen<AuthState>(authProvider, (previous, next) {
      if (next == AuthState.authenticated) {
        context.go('/home');
      }
    });

    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.lock_outline, size: 64, color: Colors.grey),
            const SizedBox(height: 32),
            const Text('Sign In Required', style: TextStyle(fontSize: 24)),
            const SizedBox(height: 32),
            if (authState == AuthState.loading)
              const CircularProgressIndicator()
            else
              ElevatedButton.icon(
                onPressed: () => ref.read(authProvider.notifier).login(),
                icon: const Icon(Icons.login),
                label: const Text('Sign in with Google'),
              ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () {
                // Skip-auth dev flag should bypass this screen directly,
                // but we add a dev bypass button just in case.
                context.go('/home');
              },
              child: const Text('Continue in Dev Mode (Skip Auth)'),
            )
          ],
        ),
      ),
    );
  }
}
