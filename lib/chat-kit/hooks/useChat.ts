'use client';

import { useState, useCallback } from 'react';
import type { ChatMessage, UseChatOptions, UseChatReturn, ChatAPIRequest, ChatAPIResponse } from '../types';

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { apiEndpoint, initialMessages = [], onError } = options;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    // Add user message immediately
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    // Add placeholder for assistant response
    const assistantPlaceholderId = generateId();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isLoading: true,
      },
    ]);

    try {
      // Build messages for API (exclude the loading placeholder)
      const apiMessages = [...messages, userMessage].map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: apiMessages } satisfies ChatAPIRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Chat API error: ${response.status} - ${errorText}`);
      }

      const data: ChatAPIResponse = await response.json();

      // Replace placeholder with actual response
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantPlaceholderId
            ? {
                ...msg,
                content: data.message.content,
                toolCalls: data.message.toolCalls,
                isLoading: false,
              }
            : msg
        )
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      onError?.(error);

      // Remove the placeholder message on error
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantPlaceholderId));
    } finally {
      setIsLoading(false);
    }
  }, [apiEndpoint, messages, isLoading, onError]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    error,
    clearMessages,
  };
}
