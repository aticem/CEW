/**
 * AIAssistant Component
 * Main floating chat panel for AI-powered Q&A
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import AIAssistantButton from './AIAssistantButton';
import ChatMessage, { LoadingMessage } from './ChatMessage';
import { AI_CONFIG } from '../../config/aiService';
import './aiAssistant.css';

// Use centralized config
const AI_SERVICE_URL = AI_CONFIG.baseUrl;

// Quick suggestion queries
const QUICK_SUGGESTIONS = [
  'MC4 connector nedir?',
  'ITP requirements?',
  'Panel installation steps?',
];

export default function AIAssistant() {
  // State
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [sessionId] = useState(() => `session_${Date.now()}`);

  // Refs
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Check service health
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (res.ok) {
        const data = await res.json();
        setServiceStatus(data.status === 'ok' ? 'online' : 'offline');
        setError(null);
      } else {
        setServiceStatus('offline');
      }
    } catch {
      setServiceStatus('offline');
    }
  }, []);

  // Check health on mount and when panel opens
  useEffect(() => {
    if (isOpen) {
      checkHealth();
    }
  }, [isOpen, checkHealth]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current && messages.length > 0) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  // Add welcome message when first opened
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: 'Merhaba! 👋 I\'m CEW AI Assistant. I can answer questions about project documents and technical specifications.\n\nHow can I help you today?',
        timestamp: Date.now(),
        sources: [],
      }]);
    }
  }, [isOpen, messages.length]);

  // Send message to API
  const sendMessage = async (text) => {
    if (!text.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${AI_SERVICE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          sessionId,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message,
          sources: data.sources || [],
          timestamp: Date.now(),
          queryType: data.queryType,
          confidence: data.confidence,
        }]);
        setServiceStatus('online');
      } else {
        // Handle API error response
        const errorMsg = data.error?.message || data.message || 'Failed to get response';
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: errorMsg,
          timestamp: Date.now(),
          error: true,
        }]);
      }
    } catch (err) {
      console.error('AI Chat Error:', err);
      setServiceStatus('offline');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Unable to connect to AI service. Please ensure the backend is running.',
        timestamp: Date.now(),
        error: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle form submit
  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Handle quick suggestion click
  const handleSuggestionClick = (suggestion) => {
    sendMessage(suggestion);
  };

  // Clear chat history
  const handleClearChat = () => {
    setMessages([{
      role: 'assistant',
      content: 'Chat cleared. How can I help you?',
      timestamp: Date.now(),
      sources: [],
    }]);
  };

  // Toggle panel
  const togglePanel = () => {
    setIsOpen(prev => !prev);
    setIsMinimized(false);
  };

  // Toggle minimize
  const toggleMinimize = () => {
    setIsMinimized(prev => !prev);
  };

  return (
    <>
      {/* Floating Action Button */}
      <AIAssistantButton
        isOpen={isOpen}
        onClick={togglePanel}
        hasNewMessage={false}
      />

      {/* Chat Panel */}
      {isOpen && (
        <div className={`ai-chat-panel ${isMinimized ? 'minimized' : ''}`}>
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-title">
              <span className="ai-chat-title-icon">🤖</span>
              <span className="ai-chat-title-text">AI Assistant</span>
              <div className={`ai-chat-status ${serviceStatus}`}>
                <span className="ai-chat-status-dot"></span>
                <span>{serviceStatus === 'online' ? 'Online' : serviceStatus === 'checking' ? '...' : 'Offline'}</span>
              </div>
            </div>
            
            <div className="ai-chat-header-actions">
              <button
                type="button"
                className="ai-chat-header-btn"
                onClick={handleClearChat}
                title="Clear chat"
              >
                🗑️
              </button>
              <button
                type="button"
                className="ai-chat-header-btn"
                onClick={toggleMinimize}
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? '▲' : '▼'}
              </button>
              <button
                type="button"
                className="ai-chat-header-btn close"
                onClick={togglePanel}
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {serviceStatus === 'offline' && (
            <div className="ai-chat-error-banner">
              <span>⚠️ AI Service offline</span>
              <button type="button" onClick={checkHealth}>Retry</button>
            </div>
          )}

          {/* Messages */}
          <div className="ai-chat-body">
            {messages.length === 0 ? (
              <div className="ai-chat-empty">
                <div className="ai-chat-empty-icon">💬</div>
                <div className="ai-chat-empty-text">
                  Ask me anything about project documents
                </div>
                <div className="ai-chat-empty-hint">
                  I can help with specifications, procedures, and technical details
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <ChatMessage key={idx} message={msg} />
                ))}
                {isLoading && <LoadingMessage />}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Quick Suggestions (show only when no messages) */}
          {messages.length === 1 && !isLoading && (
            <div className="ai-chat-suggestions">
              <div className="ai-chat-suggestions-title">Quick questions</div>
              <div className="ai-chat-suggestions-list">
                {QUICK_SUGGESTIONS.map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="ai-chat-suggestion"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="ai-chat-input-wrapper">
            <form className="ai-chat-input-form" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                type="text"
                className="ai-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={serviceStatus === 'offline' ? 'Service unavailable...' : 'Ask a question...'}
                disabled={isLoading || serviceStatus === 'offline'}
              />
              <button
                type="submit"
                className="ai-chat-send-btn"
                disabled={isLoading || !input.trim() || serviceStatus === 'offline'}
              >
                {isLoading ? '...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
