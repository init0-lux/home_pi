import '../../domain/entities/chat_message.dart';
import '../../domain/repositories/chat_repository.dart';
import '../datasources/hub_rest_datasource.dart';
import '../datasources/local_db_datasource.dart';

class ChatRepositoryImpl implements ChatRepository {
  final HubRestDatasource restDatasource;
  final LocalDbDatasource localDbDatasource;

  ChatRepositoryImpl({
    required this.restDatasource,
    required this.localDbDatasource,
  });

  @override
  Future<List<ChatMessage>> getHistory() async {
    return await localDbDatasource.getCachedChatHistory();
  }

  @override
  Future<ChatMessage> sendMessage(String text) async {
    final response = await restDatasource.sendMcpQuery(text);
    return ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      text: response.response,
      isUser: false,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<void> saveMessage(ChatMessage message) async {
    await localDbDatasource.saveChatMessage(message);
  }

  @override
  Future<void> clearHistory() async {
    await localDbDatasource.clearChatHistory();
  }
}
