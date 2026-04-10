import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/usecases/discover_hub.dart';

enum ConnectionState {
  discovering,
  connecting,
  connected,
  degraded,
  offline
}

class HubConnectionNotifier extends StateNotifier<ConnectionState> {
  final DiscoverHub _discoverHub;
  String? currentHubUrl;

  HubConnectionNotifier(this._discoverHub) : super(ConnectionState.discovering) {
    _initDiscovery();
  }

  Future<void> _initDiscovery() async {
    state = ConnectionState.discovering;
    try {
      final url = await _discoverHub.call();
      currentHubUrl = url;
      // Normally verify /health here for CONNECTING state, simplified structure:
      state = ConnectionState.connected;
    } catch (e) {
      state = ConnectionState.offline;
    }
  }

  void setDegraded() {
    if (state == ConnectionState.connected) {
      state = ConnectionState.degraded;
    }
  }

  void setConnected() {
    state = ConnectionState.connected;
  }
  
  void setOffline() {
    state = ConnectionState.offline;
  }
  
  void retry() {
    _initDiscovery();
  }
}

// In a real app we would inject DiscoverHub implementation here.
// For now this is a scaffolded provider placeholder.
final hubConnectionProvider = StateNotifierProvider<HubConnectionNotifier, ConnectionState>((ref) {
  throw UnimplementedError('Dependencies not injected yet');
});
