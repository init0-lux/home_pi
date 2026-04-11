import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/device.dart';
import '../../domain/usecases/get_devices.dart';
import '../../domain/usecases/toggle_device.dart';
import 'dart:convert';
import '../../data/models/state_payload.dart';
import '../../data/models/heartbeat_payload.dart';

class DevicesNotifier extends StateNotifier<AsyncValue<List<Device>>> {
  final GetDevices _getDevices;
  final ToggleDevice _toggleDevice;

  DevicesNotifier(this._getDevices, this._toggleDevice) : super(const AsyncValue.loading()) {
    fetchDevices();
  }

  Future<void> fetchDevices() async {
    state = const AsyncValue.loading();
    try {
      final devices = await _getDevices.call();
      state = AsyncValue.data(devices);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  void handleMqttMessage(String topic, String payloadString) {
    if (state is! AsyncData) return;
    
    final currentList = state.value!;
    
    try {
      final payload = jsonDecode(payloadString);
      
      if (topic.endsWith('state')) {
        final statePayload = StatePayload.fromJson(payload);
        state = AsyncValue.data(currentList.map((d) {
          if (d.deviceId == statePayload.deviceId) {
            return d.copyWith(state: statePayload.state);
          }
          return d;
        }).toList());
      } else if (topic.endsWith('heartbeat')) {
        final hbPayload = HeartbeatPayload.fromJson(payload);
        state = AsyncValue.data(currentList.map((d) {
          if (d.deviceId == hbPayload.deviceId) {
            return d.copyWith(
              online: hbPayload.status == 'ONLINE',
              lastSeen: DateTime.fromMillisecondsSinceEpoch(hbPayload.timestamp * 1000),
            );
          }
          return d;
        }).toList());
      }
    } catch (e) {
      // Parse error, ignore
    }
  }

  Future<void> toggleDevice(String deviceId, String newState) async {
    // Optimistic Update
    final previousState = state;
    if (state is AsyncData) {
      final currentList = state.value!;
      state = AsyncValue.data(currentList.map((d) {
        if (d.deviceId == deviceId) {
          return d.copyWith(state: newState);
        }
        return d;
      }).toList());
    }

    try {
      await _toggleDevice.call(deviceId, newState);
      // Actual confirmed state will be updated by MQTT later natively!
    } catch (e) {
      // Rollback
      state = previousState;
    }
  }
}

final devicesProvider = StateNotifierProvider<DevicesNotifier, AsyncValue<List<Device>>>((ref) {
  throw UnimplementedError();
});
