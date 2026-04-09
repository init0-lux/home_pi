import '../entities/chat_message.dart';

abstract class ChatRepository {
  Future<String> sendQuery(String query);
  Future<List<ChatMessage>> getChatHistory();
}
