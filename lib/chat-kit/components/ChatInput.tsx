'use client';

import React, { useState, useCallback, KeyboardEvent } from 'react';
import { cn } from '../utils';
import type { ChatInputProps, ChatVariant } from '../types';

const variantStyles: Record<ChatVariant, { container: string; input: string; button: string }> = {
  default: {
    container: 'flex items-end gap-2 p-4 border-t border-gray-200 bg-white',
    input: [
      'flex-1 resize-none rounded-lg border border-gray-300 px-4 py-2',
      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
      'placeholder:text-gray-400 min-h-[40px] max-h-[200px]'
    ].join(' '),
    button: [
      'px-4 py-2 rounded-lg bg-blue-500 text-white font-medium',
      'hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed',
      'transition-colors'
    ].join(' '),
  },
  shadcn: {
    container: 'flex items-end gap-2 p-4 border-t bg-background',
    input: [
      'flex-1 resize-none rounded-md border border-input px-4 py-2',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
      'placeholder:text-muted-foreground min-h-[40px] max-h-[200px] bg-background'
    ].join(' '),
    button: [
      'px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium',
      'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed',
      'transition-colors'
    ].join(' '),
  },
};

export function ChatInput({
  onSend,
  isLoading = false,
  placeholder = 'Ask a question...',
  variant = 'default',
  className,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const styles = variantStyles[variant];

  const handleSubmit = useCallback(() => {
    if (value.trim() && !isLoading) {
      onSend(value);
      setValue('');
    }
  }, [value, isLoading, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Auto-resize textarea
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target;
    setValue(target.value);
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
  }, []);

  return (
    <div className={cn(styles.container, className)}>
      <textarea
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        rows={1}
        className={styles.input}
      />
      <button
        onClick={handleSubmit}
        disabled={!value.trim() || isLoading}
        className={styles.button}
      >
        {isLoading ? (
          <span className="inline-flex items-center">
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Thinking...
          </span>
        ) : (
          'Send'
        )}
      </button>
    </div>
  );
}
