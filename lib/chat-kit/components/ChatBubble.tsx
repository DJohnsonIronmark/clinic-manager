'use client';

import React from 'react';
import { cn } from '../utils';
import type { ChatBubbleProps, ChatVariant } from '../types';

const variantStyles: Record<ChatVariant, { user: string; assistant: string; container: string }> = {
  default: {
    container: 'flex w-full',
    user: 'bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-2 max-w-[80%]',
    assistant: 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md px-4 py-2 max-w-[80%]',
  },
  shadcn: {
    container: 'flex w-full',
    user: 'bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%]',
    assistant: 'bg-muted text-foreground rounded-lg px-4 py-2 max-w-[80%]',
  },
};

export function ChatBubble({ message, variant = 'default', className }: ChatBubbleProps) {
  const styles = variantStyles[variant];
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        styles.container,
        isUser ? 'justify-end' : 'justify-start',
        className
      )}
    >
      <div className={cn(isUser ? styles.user : styles.assistant)}>
        {message.isLoading ? (
          <LoadingDots variant={variant} />
        ) : (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsDisplay toolCalls={message.toolCalls} variant={variant} />
        )}
      </div>
    </div>
  );
}

function LoadingDots({ variant }: { variant: ChatVariant }) {
  return (
    <div className="flex space-x-1">
      <div
        className={cn(
          'w-2 h-2 rounded-full animate-bounce',
          variant === 'shadcn' ? 'bg-foreground/50' : 'bg-gray-400'
        )}
        style={{ animationDelay: '0ms' }}
      />
      <div
        className={cn(
          'w-2 h-2 rounded-full animate-bounce',
          variant === 'shadcn' ? 'bg-foreground/50' : 'bg-gray-400'
        )}
        style={{ animationDelay: '150ms' }}
      />
      <div
        className={cn(
          'w-2 h-2 rounded-full animate-bounce',
          variant === 'shadcn' ? 'bg-foreground/50' : 'bg-gray-400'
        )}
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}

function ToolCallsDisplay({
  toolCalls,
  variant,
}: {
  toolCalls: NonNullable<ChatBubbleProps['message']['toolCalls']>;
  variant: ChatVariant;
}) {
  const [expanded, setExpanded] = React.useState(false);

  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-current/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'text-xs opacity-60 hover:opacity-100 transition-opacity',
          'flex items-center gap-1'
        )}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>
          {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {toolCalls.map((call, index) => (
            <div
              key={index}
              className={cn(
                'text-xs p-2 rounded',
                variant === 'shadcn' ? 'bg-background/50' : 'bg-white/50'
              )}
            >
              <div className="font-mono font-semibold">{call.toolName}</div>
              <details className="mt-1">
                <summary className="cursor-pointer opacity-60">Input</summary>
                <pre className="mt-1 overflow-auto text-[10px]">
                  {JSON.stringify(call.input, null, 2)}
                </pre>
              </details>
              <details className="mt-1">
                <summary className="cursor-pointer opacity-60">Output</summary>
                <pre className="mt-1 overflow-auto text-[10px] max-h-40">
                  {JSON.stringify(call.output, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
