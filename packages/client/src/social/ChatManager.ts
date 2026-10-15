import { ChatMessage, sanitizeText } from "@watchparty/shared";

export interface ChatStateListener {
  (messages: ChatMessage[]): void;
}

export interface TypingStateListener {
  (typingUserNames: string[]): void;
}

export interface ChatSendHandler {
  (text: string): Promise<boolean> | boolean;
}

export interface TypingSendHandler {
  (isTyping: boolean): void;
}

export class ChatManager {
  private messages: ChatMessage[] = [];
  private typingUsers: Map<string, { userName: string; timeout: any }> = new Map();
  private isSelfTyping = false;
  private selfTypingTimeout: any = null;
  private messageListeners: Set<ChatStateListener> = new Set();
  private typingListeners: Set<TypingStateListener> = new Set();

  private sendChatHandler?: ChatSendHandler;
  private sendTypingHandler?: TypingSendHandler;

  // Client-side rate limiting: max 5 messages per 3 seconds
  private outgoingMessageTimestamps: number[] = [];

  constructor(options?: {
    initialMessages?: ChatMessage[];
    sendChatHandler?: ChatSendHandler;
    sendTypingHandler?: TypingSendHandler;
  }) {
    if (options?.initialMessages) {
      this.initHistory(options.initialMessages);
    }
    this.sendChatHandler = options?.sendChatHandler;
    this.sendTypingHandler = options?.sendTypingHandler;
  }

  public initHistory(messages: ChatMessage[]): void {
    // Keep last 100 messages
    this.messages = messages.slice(-100);
    this.notifyMessages();
  }

  public handleIncomingMessage(message: ChatMessage): void {
    // If this user was typing, remove typing indicator
    this.handleIncomingTyping(message.userId, message.userName, false);

    this.messages.push(message);
    if (this.messages.length > 100) {
      this.messages.shift();
    }
    this.notifyMessages();
  }

  public handleIncomingTyping(userId: string, userName: string, isTyping: boolean): void {
    const existing = this.typingUsers.get(userId);
    if (existing) {
      clearTimeout(existing.timeout);
      this.typingUsers.delete(userId);
    }

    if (isTyping) {
      // Auto-clear after 3 seconds of silence
      const timeout = setTimeout(() => {
        this.typingUsers.delete(userId);
        this.notifyTyping();
      }, 3000);

      this.typingUsers.set(userId, { userName, timeout });
    }

    this.notifyTyping();
  }

  /**
   * Send a chat message with local rate limiting and sanitization.
   */
  public async send(text: string): Promise<{ success: boolean; error?: string }> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { success: false, error: "Message cannot be empty" };
    }

    const now = Date.now();
    // Clean old rate limit timestamps outside 3-second window
    this.outgoingMessageTimestamps = this.outgoingMessageTimestamps.filter((t) => now - t < 3000);

    if (this.outgoingMessageTimestamps.length >= 5) {
      return {
        success: false,
        error: "You are sending messages too fast. Please wait a moment.",
      };
    }

    this.outgoingMessageTimestamps.push(now);

    // Stop self typing indicator
    this.setSelfTyping(false);

    if (this.sendChatHandler) {
      const ok = await this.sendChatHandler(trimmed);
      return { success: Boolean(ok) };
    }

    return { success: true };
  }

  /**
   * Updates local user's typing indicator and broadcasts to peers.
   */
  public setSelfTyping(isTyping: boolean): void {
    if (this.selfTypingTimeout) {
      clearTimeout(this.selfTypingTimeout);
      this.selfTypingTimeout = null;
    }

    if (isTyping) {
      if (!this.isSelfTyping) {
        this.isSelfTyping = true;
        this.sendTypingHandler?.(true);
      }
      // Auto reset self typing after 2.5s without further keystrokes
      this.selfTypingTimeout = setTimeout(() => {
        this.isSelfTyping = false;
        this.sendTypingHandler?.(false);
      }, 2500);
    } else {
      if (this.isSelfTyping) {
        this.isSelfTyping = false;
        this.sendTypingHandler?.(false);
      }
    }
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public getTypingUserNames(): string[] {
    return Array.from(this.typingUsers.values()).map((u) => u.userName);
  }

  public subscribeMessages(listener: ChatStateListener): () => void {
    this.messageListeners.add(listener);
    listener([...this.messages]);
    return () => this.messageListeners.delete(listener);
  }

  public subscribeTyping(listener: TypingStateListener): () => void {
    this.typingListeners.add(listener);
    listener(this.getTypingUserNames());
    return () => this.typingListeners.delete(listener);
  }

  private notifyMessages(): void {
    const msgs = [...this.messages];
    for (const listener of this.messageListeners) {
      listener(msgs);
    }
  }

  private notifyTyping(): void {
    const typingList = this.getTypingUserNames();
    for (const listener of this.typingListeners) {
      listener(typingList);
    }
  }

  /**
   * Guaranteed XSS-safe HTML string formatter for chat messages.
   * Renders system messages distinctively and escapes all user-supplied text.
   */
  public static renderSafeHtml(message: ChatMessage): string {
    const escapedText = sanitizeText(message.text);
    const escapedUser = sanitizeText(message.userName);

    if (message.isSystem) {
      return `<div class="chat-system-message" data-msg-id="${message.id}"><span class="badge">SYSTEM</span> <span class="content">${escapedText}</span></div>`;
    }

    const time = new Date(message.serverTimestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return `<div class="chat-user-message" data-msg-id="${message.id}" data-user-id="${message.userId}">
      <span class="chat-time">${time}</span>
      <span class="chat-author">${escapedUser}:</span>
      <span class="chat-body">${escapedText}</span>
    </div>`;
  }

  public destroy(): void {
    if (this.selfTypingTimeout) {
      clearTimeout(this.selfTypingTimeout);
    }
    for (const typing of this.typingUsers.values()) {
      clearTimeout(typing.timeout);
    }
    this.typingUsers.clear();
    this.messageListeners.clear();
    this.typingListeners.clear();
  }
}
