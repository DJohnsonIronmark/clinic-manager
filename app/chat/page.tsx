'use client';

import { ChatContainer, useChat } from '@/lib/chat-kit';
import Link from 'next/link';

export default function ChatPage() {
  const { messages, sendMessage, isLoading, error } = useChat({
    apiEndpoint: '/api/chat',
    onError: (err) => console.error('Chat error:', err),
  });

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            &larr; Back to Territory Manager
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">
            Clinic Data Assistant
          </h1>
          <p className="text-gray-600 mt-1">
            Ask questions about clinic territories, locations, and geographic data
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error.message}
          </div>
        )}

        <div className="h-[600px] border border-gray-300 rounded-lg overflow-hidden shadow-sm">
          <ChatContainer
            messages={messages}
            onSendMessage={sendMessage}
            isLoading={isLoading}
            placeholder="Ask about clinic data... (e.g., 'How many clinics are in Texas?')"
            variant="default"
          />
        </div>

        <div className="mt-4 text-sm text-gray-500">
          <p className="font-medium mb-2">Example questions:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>How many clinics are in Texas?</li>
            <li>Show me all urban clinics</li>
            <li>What states have the most clinics?</li>
            <li>List clinics in California</li>
            <li>What&apos;s the metro type breakdown?</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
