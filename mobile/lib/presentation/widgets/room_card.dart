import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../domain/entities/room.dart';

class RoomCard extends StatefulWidget {
  final Room room;

  const RoomCard({super.key, required this.room});

  @override
  State<RoomCard> createState() => _RoomCardState();
}

class _RoomCardState extends State<RoomCard> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    // Device counts (in Phase 2 this will dynamically sync with device status)
    final deviceCount = widget.room.devices.length;
    final onlineCount = widget.room.devices.where((d) => d.online).length;

    return GestureDetector(
      onTapDown: (_) => setState(() => _isPressed = true),
      onTapUp: (_) => setState(() => _isPressed = false),
      onTapCancel: () => setState(() => _isPressed = false),
      onTap: () {
        context.push('/room/${widget.room.roomId}');
      },
      child: AnimatedScale(
        scale: _isPressed ? 0.98 : 1.0,
        duration: const Duration(milliseconds: 100),
        child: Card(
          elevation: 2,
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.room.roomId, // Replace with friendly name if added
                  style: Theme.of(context).textTheme.titleLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const Spacer(),
                Text(
                  '$deviceCount devices',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  '$onlineCount online',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
