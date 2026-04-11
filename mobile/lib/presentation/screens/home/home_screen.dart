import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/rooms_provider.dart';
import '../widgets/room_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final roomsState = ref.watch(roomsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('⚡ Zapp'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              // Nav to settings
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.all(16.0),
              child: Text('🏠 All Rooms', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.read(roomsProvider.notifier).fetchRooms(),
                child: roomsState.when(
                  data: (rooms) {
                    if (rooms.isEmpty) {
                      return const Center(child: Text('No rooms found.'));
                    }
                    return GridView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        crossAxisSpacing: 16,
                        mainAxisSpacing: 16,
                        childAspectRatio: 1.1,
                      ),
                      itemCount: rooms.length,
                      itemBuilder: (context, index) {
                        return RoomCard(room: rooms[index]);
                      },
                    );
                  },
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (error, stack) => Center(
                    child: Text('Error: $error', style: const TextStyle(color: Colors.red)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
