import 'package:nsd/nsd.dart' as nsd;
import '../../core/config/constants.dart';
import '../../core/error/exceptions.dart';

class MdnsDatasource {
  Future<String> discoverHub() async {
    final discovery = await nsd.startDiscovery(AppConstants.mdnsServiceType);
    
    try {
      await for (final event in discovery.addListener()) {
        final service = event.service;
        if (service != null && service.name != null && service.name!.contains('Zapp')) {
          final addresses = service.addresses;
          if (addresses != null && addresses.isNotEmpty) {
            final ip = addresses.first.address;
            final port = service.port ?? 3000;
            await nsd.stopDiscovery(discovery);
            return 'http://$ip:$port';
          }
        }
      }
    } catch (e) {
      await nsd.stopDiscovery(discovery);
      throw ServerException('Failed to discover hub via mDNS: $e');
    }
    
    await Future.delayed(AppConstants.discoveryTimeout);
    await nsd.stopDiscovery(discovery);
    throw ServerException('mDNS Discovery Timeout');
  }
}
