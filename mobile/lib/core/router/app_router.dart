import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../presentation/providers/hub_connection_provider.dart';

// Placeholder screen imports for routes
import '../../presentation/screens/splash/splash_screen.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');
final GlobalKey<NavigatorState> _shellNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'shell');

final goRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/splash',
  routes: [
    GoRoute(
      path: '/splash',
      builder: (context, state) => const SplashScreen(), // Implemented in next commit
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const Scaffold(body: Center(child: Text('Login'))),
    ),
    GoRoute(
      path: '/onboarding',
      builder: (context, state) => const Scaffold(body: Center(child: Text('Onboarding'))),
    ),
    ShellRoute(
      navigatorKey: _shellNavigatorKey,
      builder: (context, state, child) {
        // Here we will implement the bottom navigation bar scaffold
        return Scaffold(
          body: child,
          bottomNavigationBar: BottomNavigationBar(
            items: const [
              BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home'),
              BottomNavigationBarItem(icon: Icon(Icons.chat), label: 'Chat'),
              BottomNavigationBarItem(icon: Icon(Icons.add), label: 'Add'),
            ],
            onTap: (index) {
              if (index == 0) context.go('/home');
              if (index == 1) context.go('/chat');
              if (index == 2) context.go('/provision');
            },
          ),
        );
      },
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => const Scaffold(body: Center(child: Text('Home Screen Placeholder'))),
        ),
        GoRoute(
          path: '/chat',
          builder: (context, state) => const Scaffold(body: Center(child: Text('Chat Screen Placeholder'))),
        ),
        GoRoute(
          path: '/provision',
          builder: (context, state) => const Scaffold(body: Center(child: Text('Provision Screen Placeholder'))),
        ),
      ],
    ),
  ],
  redirect: (context, state) {
    // We will implement auth/discovery redirect guards here.
    return null;
  },
);
