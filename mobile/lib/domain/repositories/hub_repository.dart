import '../entities/hub_config.dart';

abstract class HubRepository {
  Future<String> discoverHub();
  Future<bool> getHealth(String ip);
  Future<HubConfig> getHubConfig();
}
