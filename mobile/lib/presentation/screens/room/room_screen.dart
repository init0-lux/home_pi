import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/devices_provider.dart';
import '../widgets/device_card.dart';

class RoomScreen extends ConsumerWidget {
  final String roomId;
  
  const RoomScreen({super.key, required this.roomId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final devicesState = ref.watch(devicesProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(roomId), // Would be friendly room name ideally
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  OutlinedButton(
                    onPressed: () {
                      // Logic to toggle all ON for this room
                      if (devicesState is AsyncData) {
                        for (var d in devicesState.value!.where((d) => d.roomId == roomId)) {
                          ref.read(devicesProvider.notifier).toggleDevice(d.deviceId, 'ON');
                        }
                      }
                    },
                    child: const Text('All ON'),
                  ),
                  OutlinedButton(
                    onPressed: () {
                      // Logic to toggle all OFF for this room
                      if (devicesState is AsyncData) {
                        for (var d in devicesState.value!.where((d) => d.roomId == roomId)) {
                          ref.read(devicesProvider.notifier).toggleDevice(d.deviceId, 'OFF');
                        }
                      }
                    },
                    child: const Text('All OFF'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: devicesState.when(
                data: (devices) {
                  final roomDevices = devices.where((d) => d.roomId == roomId).toList();
                  if (roomDevices.isEmpty) {
                    return const Center(child: Text('No devices in this room.'));
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: roomDevices.length,
                    itemBuilder: (context, index) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8.0),
                        child: DeviceCard(device: roomDevices[index]),
                      );
                    },
                  );
                },
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, stack) => Center(
                  child: Text('Error: $error', style: const TextStyle(color: Colors.red)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
