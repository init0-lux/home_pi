import '../../domain/entities/chat_message.dart';
import '../repositories/chat_repository.dart';

class SendChatMessage {
  final ChatRepository repository;

  SendChatMessage(this.repository);

  Future<ChatMessage> call(String text) async {
    final userMessage = ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      text: text,
      isUser: true,
      timestamp: DateTime.now(),
    );
    await repository.saveMessage(userMessage);
    
    final agentResponse = await repository.sendMessage(text);
    await repository.saveMessage(agentResponse);
    return agentResponse;
  }
}
