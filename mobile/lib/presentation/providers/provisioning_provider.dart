import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/usecases/provision_device.dart';

enum ProvisionStep {
  idle,
  connectingToDevice, // Step 2,3 visually
  pushingCredentials, // Step 4 visually
  verifying, // Step 5 visually
  success,
  error
}

class ProvisioningState {
  final ProvisionStep step;
  final String? errorMessage;

  ProvisioningState({required this.step, this.errorMessage});

  factory ProvisioningState.idle() => ProvisioningState(step: ProvisionStep.idle);
  factory ProvisioningState.connecting() => ProvisioningState(step: ProvisionStep.connectingToDevice);
  factory ProvisioningState.pushing() => ProvisioningState(step: ProvisionStep.pushingCredentials);
  factory ProvisioningState.verifying() => ProvisioningState(step: ProvisionStep.verifying);
  factory ProvisioningState.success() => ProvisioningState(step: ProvisionStep.success);
  factory ProvisioningState.error(String msg) => ProvisioningState(step: ProvisionStep.error, errorMessage: msg);
}

class ProvisioningNotifier extends StateNotifier<ProvisioningState> {
  final ProvisionDevice _provisionDevice;

  ProvisioningNotifier(this._provisionDevice) : super(ProvisioningState.idle());

  Future<void> startProvisioning(
    String deviceSsid, 
    String devicePass, 
    String homeSsid, 
    String homePass,
    String deviceId
  ) async {
    try {
      state = ProvisioningState.connecting();
      // Assume delays for UX
      await Future.delayed(const Duration(seconds: 1));
      
      state = ProvisioningState.pushing();
      await Future.delayed(const Duration(seconds: 1));

      state = ProvisioningState.verifying();
      await _provisionDevice.executeFullFlow(deviceSsid, devicePass, homeSsid, homePass, deviceId);
      
      state = ProvisioningState.success();
    } catch (e) {
      state = ProvisioningState.error(e.toString());
    }
  }

  void reset() {
    state = ProvisioningState.idle();
  }
}

final provisioningProvider = StateNotifierProvider<ProvisioningNotifier, ProvisioningState>((ref) {
  throw UnimplementedError();
});
