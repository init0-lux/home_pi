import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/provisioning_provider.dart';

class ProvisionWizardScreen extends ConsumerStatefulWidget {
  const ProvisionWizardScreen({super.key});

  @override
  ConsumerState<ProvisionWizardScreen> createState() => _ProvisionWizardScreenState();
}

class _ProvisionWizardScreenState extends ConsumerState<ProvisionWizardScreen> {
  final TextEditingController _homeSsidCtrl = TextEditingController();
  final TextEditingController _homePassCtrl = TextEditingController();

  int _currentUiStep = 0;

  @override
  Widget build(BuildContext context) {
    final provState = ref.watch(provisioningProvider);

    // Map provider state to stepper or UI element implicitly, for simplicity we show a linear visual
    return Scaffold(
      appBar: AppBar(title: const Text('Add New Device')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (provState.step == ProvisionStep.idle) ...[
                const Text(
                  'Let\'s connect your new Zapp device.',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _homeSsidCtrl,
                  decoration: const InputDecoration(labelText: 'Home Wi-Fi Network (SSID)'),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _homePassCtrl,
                  decoration: const InputDecoration(labelText: 'Wi-Fi Password'),
                  obscureText: true,
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: () {
                    ref.read(provisioningProvider.notifier).startProvisioning(
                      'Zapp-XXXX', 
                      '12345678', 
                      _homeSsidCtrl.text, 
                      _homePassCtrl.text,
                      'temp-device-id'
                    );
                  },
                  child: const Text('Start Provisioning'),
                ),
              ] else if (provState.step == ProvisionStep.error) ...[
                const Icon(Icons.error_outline, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('Provisioning Failed', textAlign: TextAlign.center, style: TextStyle(fontSize: 20)),
                Text(provState.errorMessage ?? 'Unknown error', textAlign: TextAlign.center),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: () => ref.read(provisioningProvider.notifier).reset(),
                  child: const Text('Retry'),
                )
              ] else if (provState.step == ProvisionStep.success) ...[
                const Icon(Icons.check_circle_outline, size: 64, color: Colors.green),
                const SizedBox(height: 16),
                const Text('Device Connected!', textAlign: TextAlign.center, style: TextStyle(fontSize: 24)),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: () {
                    ref.read(provisioningProvider.notifier).reset();
                    // In real app, context.go('/home')
                  },
                  child: const Text('Done'),
                )
              ] else ...[
                const Spacer(),
                const Center(child: CircularProgressIndicator()),
                const SizedBox(height: 24),
                Text(
                  _getStateMessage(provState.step),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 18),
                ),
                const Spacer(),
              ]
            ],
          ),
        ),
      ),
    );
  }

  String _getStateMessage(ProvisionStep step) {
    switch(step) {
      case ProvisionStep.connectingToDevice: return "Connecting to device...";
      case ProvisionStep.pushingCredentials: return "Sending network details...";
      case ProvisionStep.verifying: return "Verifying connection to hub...";
      default: return "";
    }
  }

  @override
  void dispose() {
    _homeSsidCtrl.dispose();
    _homePassCtrl.dispose();
    super.dispose();
  }
}
