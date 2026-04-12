import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/chat_message.dart';
import '../../domain/usecases/send_chat_message.dart';
import '../../domain/repositories/chat_repository.dart';

class ChatState {
  final List<ChatMessage> messages;
  final bool isTyping;

  ChatState({required this.messages, this.isTyping = false});

  ChatState copyWith({List<ChatMessage>? messages, bool? isTyping}) {
    return ChatState(
      messages: messages ?? this.messages,
      isTyping: isTyping ?? this.isTyping,
    );
  }
}

class ChatNotifier extends StateNotifier<ChatState> {
  final SendChatMessage _sendChatMessage;
  final ChatRepository _chatRepository;

  ChatNotifier(this._sendChatMessage, this._chatRepository) : super(ChatState(messages: [])) {
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    final history = await _chatRepository.getHistory();
    state = state.copyWith(messages: history);
  }

  Future<void> sendMessage(String text) async {
    if (text.trim().isEmpty) return;

    final userMessage = ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      text: text,
      isUser: true,
      timestamp: DateTime.now(),
    );

    // Optimistic UI
    state = state.copyWith(
      messages: [...state.messages, userMessage],
      isTyping: true,
    );

    try {
      final agentResponse = await _sendChatMessage.call(text);
      state = state.copyWith(
        messages: [...state.messages, agentResponse],
        isTyping: false,
      );
    } catch (e) {
      // Show error message inline
      final errorMessage = ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        text: 'Failed to connect to agent.',
        isUser: false,
        timestamp: DateTime.now(),
      );
      state = state.copyWith(
        messages: [...state.messages, errorMessage],
        isTyping: false,
      );
    }
  }

  Future<void> clearHistory() async {
    await _chatRepository.clearHistory();
    state = state.copyWith(messages: []);
  }
}

// Scaffolded provider
final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  throw UnimplementedError();
});
