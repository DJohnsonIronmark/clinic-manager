'use client';

import React from 'react';
import { cn } from '../utils';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import type { ChatContainerProps, ChatVariant } from '../types';

const variantStyles: Record<ChatVariant, string> = {
  default: 'flex flex-col h-full bg-white rounded-lg shadow-lg overflow-hidden',
  shadcn: 'flex flex-col h-full bg-background rounded-lg border overflow-hidden',
};

export function ChatContainer({
  messages,
  onSendMessage,
  isLoading = false,
  placeholder,
  variant = 'default',
  className,
  children,
}: ChatContainerProps) {
  return (
    <div className={cn(variantStyles[variant], className)}>
      {children ? (
        children
      ) : (
        <>
          <ChatMessages messages={messages} variant={variant} className="flex-1" />
          <ChatInput
            onSend={onSendMessage}
            isLoading={isLoading}
            placeholder={placeholder}
            variant={variant}
          />
        </>
      )}
    </div>
  );
}

// Compound components for custom layouts
ChatContainer.Messages = ChatMessages;
ChatContainer.Input = ChatInput;
