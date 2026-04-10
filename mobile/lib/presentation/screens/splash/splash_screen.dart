import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/hub_connection_provider.dart';

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionState = ref.watch(hubConnectionProvider);

    // Watch for state changes to navigate
    ref.listen<ConnectionState>(hubConnectionProvider, (previous, next) {
      if (next == ConnectionState.connected || next == ConnectionState.degraded) {
        // Will evaluate auth in a later commit, for now navigate to home
        context.go('/home');
      }
    });

    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              '⚡ Zapp',
              style: TextStyle(
                fontSize: 48,
                fontWeight: FontWeight.bold,
                color: Color(0xFFFF6B35), // Primary orange
              ),
            ),
            const SizedBox(height: 32),
            if (connectionState == ConnectionState.discovering)
              const Column(
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Discovering Hub...'),
                ],
              ),
            if (connectionState == ConnectionState.offline)
              Column(
                children: [
                  const Icon(Icons.wifi_off, size: 48, color: Colors.grey),
                  const SizedBox(height: 16),
                  const Text('No Hub Found'),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => ref.read(hubConnectionProvider.notifier).retry(),
                    child: const Text('Retry'),
                  ),
                  TextButton(
                    onPressed: () {
                      // Manual entry fallback
                    },
                    child: const Text('Enter IP Manually'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
