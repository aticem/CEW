/**
 * AI Assistant Component for CEW Solar Construction App
 * 
 * A floating chat widget that connects to the ai-service backend.
 * Supports two modes:
 * - "general": RAG-based Q&A from project documents
 * - "progress": Data analysis from construction progress records
 * 
 * Props:
 * - pageContext: Optional object with real-time screen data
 *   { module, total, completed, remaining, unit, ... }
 */
import { useState, useRef, useEffect } from 'react';

// API Configuration
const AI_SERVICE_URL = 'http://localhost:8000';

export default function AIAssistant({ pageContext = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('progress'); // Default to 'progress' when context available
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  // Auto-switch to progress mode when pageContext is provided
  useEffect(() => {
    if (pageContext && Object.keys(pageContext).length > 0) {
      setMode('progress');
    }
  }, [pageContext]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setError(null);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Build request body with optional screen_context for progress mode
      const requestBody = {
        question: userMessage,
        mode: mode,
      };
      
      // Include screen context when in progress mode and context is available
      if (mode === 'progress' && pageContext && Object.keys(pageContext).length > 0) {
        requestBody.screen_context = pageContext;
      }
      
      const response = await fetch(`${AI_SERVICE_URL}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Add AI response to chat
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer,
        source: data.source,
      }]);
    } catch (err) {
      console.error('AI Assistant error:', err);
      setError(err.message);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}. Make sure the AI service is running on ${AI_SERVICE_URL}`,
        isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-5 right-5 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg hover:from-amber-400 hover:to-orange-500 focus:outline-none focus:ring-4 focus:ring-amber-400/50 transition-all duration-200"
        aria-label={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
      >
        {isOpen ? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-5 z-[9998] flex h-[500px] w-[380px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
              <span className="font-semibold text-white">CEW AI Assistant</span>
            </div>
            <button
              onClick={clearChat}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
              title="Clear chat"
            >
              Clear
            </button>
          </div>

          {/* Mode Toggle */}
          <div className="flex border-b border-slate-700 bg-slate-800/50">
            <button
              onClick={() => setMode('general')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                mode === 'general'
                  ? 'bg-amber-500/20 text-amber-400 border-b-2 border-amber-500'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              📄 Documents
            </button>
            <button
              onClick={() => setMode('progress')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                mode === 'progress'
                  ? 'bg-amber-500/20 text-amber-400 border-b-2 border-amber-500'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              📊 Progress Data
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-8">
                <p className="mb-2">👋 Hello! I'm your AI assistant.</p>
                <p className="text-xs">
                  {mode === 'general'
                    ? 'Ask me questions about project documents.'
                    : 'Ask me about construction progress data.'}
                </p>
                {mode === 'progress' && pageContext && Object.keys(pageContext).length > 0 && (
                  <div className="mt-3 p-2 bg-green-900/30 border border-green-700/50 rounded text-green-400 text-xs">
                    <p className="font-medium">📡 Screen Context Active</p>
                    <p className="text-green-500/80 mt-1">
                      Module: {pageContext.module || 'Current View'}
                      {pageContext.total && ` • Total: ${pageContext.total.toLocaleString()}`}
                    </p>
                  </div>
                )}
              </div>
            )}
            
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-amber-500 text-black'
                      : msg.isError
                      ? 'bg-red-900/50 text-red-300 border border-red-700'
                      : 'bg-slate-700 text-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.source && (
                    <p className="mt-2 text-xs opacity-70 border-t border-slate-600 pt-1">
                      📎 Source: {msg.source}
                    </p>
                  )}
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-700 rounded-lg px-4 py-3">
                  <div className="flex space-x-1">
                    <div className="h-2 w-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="h-2 w-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="h-2 w-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-700 bg-slate-800 p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'general' ? 'Ask about documents...' : 'Ask about progress...'}
                disabled={isLoading}
                className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-500">
              Mode: <span className="text-amber-400">{mode === 'general' ? 'Document Q&A' : 'Progress Analysis'}</span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
