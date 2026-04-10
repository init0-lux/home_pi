import '../repositories/hub_repository.dart';

class DiscoverHub {
  final HubRepository repository;

  DiscoverHub(this.repository);

  Future<String> call() async {
    return await repository.discoverHub();
  }
}
