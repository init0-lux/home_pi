import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/colors.dart';
import '../../../domain/entities/device.dart';
import '../../providers/devices_provider.dart';

class DeviceCard extends ConsumerWidget {
  final Device device;

  const DeviceCard({super.key, required this.device});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool isOn = device.state == 'ON';
    
    // Status visual mapping (spec §8.3)
    Color activeColor = isOn ? Theme.of(context).primaryColor : Colors.grey.shade400;
    if (!device.online) {
      activeColor = Colors.grey.shade600;
    }

    return Card(
      elevation: 0,
      color: isOn && device.online ? ZappColors.primary.withAlpha(25) : null,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isOn && device.online ? ZappColors.primary.withAlpha(128) : Colors.transparent,
          width: 1,
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        leading: Icon(
          Icons.lightbulb_outline, // Assuming light type for now
          color: activeColor,
          size: 32,
        ),
        title: Text(
          device.type.toUpperCase(), // In Phase 2: Editable labels
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: device.online ? null : Colors.grey,
              ),
        ),
        subtitle: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: device.online ? ZappColors.onlineIndicator : ZappColors.offlineIndicator,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              device.online ? 'Online' : 'Offline (last seen...)', // Logic in phase 2
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        trailing: Switch(
          value: isOn,
          activeColor: ZappColors.primary,
          onChanged: device.online
              ? (value) {
                  HapticFeedback.lightImpact();
                  final newState = value ? 'ON' : 'OFF';
                  ref.read(devicesProvider.notifier).toggleDevice(device.deviceId, newState);
                }
              : null,
        ),
      ),
    );
  }
}
