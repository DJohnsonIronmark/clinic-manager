'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '../utils';
import { ChatBubble } from './ChatBubble';
import type { ChatMessagesProps, ChatVariant } from '../types';

const variantStyles: Record<ChatVariant, string> = {
  default: 'flex flex-col space-y-3 p-4 overflow-y-auto',
  shadcn: 'flex flex-col space-y-3 p-4 overflow-y-auto',
};

export function ChatMessages({ messages, variant = 'default', className }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={cn(variantStyles[variant], className)}>
      {messages.length === 0 ? (
        <EmptyState variant={variant} />
      ) : (
        messages.map((message) => (
          <ChatBubble key={message.id} message={message} variant={variant} />
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function EmptyState({ variant }: { variant: ChatVariant }) {
  return (
    <div
      className={cn(
        'flex-1 flex items-center justify-center text-center',
        variant === 'shadcn' ? 'text-muted-foreground' : 'text-gray-400'
      )}
    >
      <div>
        <div className="text-4xl mb-2">💬</div>
        <p>Ask a question about your data</p>
      </div>
    </div>
  );
}
