/**
 * CEW AI Assistant Module
 * Chat interface for document-based Q&A
 */

import { useState, useRef, useEffect } from 'react';
import { AI_CONFIG } from '../../config/aiService';
import './AIAssistantModule.css';

// Use centralized config
const AI_SERVICE_URL = AI_CONFIG.baseUrl;

export default function AIAssistantModule() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I\'m CEW AI Assistant. I can answer questions about project documents, specifications, and technical details. How can I help you?',
      sources: []
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState('checking');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Check service health on mount
  useEffect(() => {
    checkServiceHealth();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function checkServiceHealth() {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/health`);
      if (res.ok) {
        setServiceStatus('online');
      } else {
        setServiceStatus('offline');
      }
    } catch {
      setServiceStatus('offline');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput('');

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    try {
      const res = await fetch(`${AI_SERVICE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question })
      });

      const data = await res.json();

      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message,
          sources: data.sources || [],
          blocked: data.blocked,
          guardResult: data.guardResult
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Sorry, I couldn't process your question. ${data.error?.message || data.message || ''}`,
          sources: [],
          error: true
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Unable to connect to AI service. Please make sure the backend is running.',
        sources: [],
        error: true
      }]);
    } finally {
      setLoading(false);
    }
  }

  function renderMessage(msg, idx) {
    const isUser = msg.role === 'user';
    
    return (
      <div key={idx} className={`ai-message ${isUser ? 'user' : 'assistant'} ${msg.error ? 'error' : ''}`}>
        <div className="ai-message-avatar">
          {isUser ? '👤' : '🤖'}
        </div>
        <div className="ai-message-content">
          <div className="ai-message-text">{msg.content}</div>
          
          {/* Sources */}
          {msg.sources && msg.sources.length > 0 && (
            <div className="ai-message-sources">
              <span className="sources-label">📄 Sources:</span>
              {msg.sources.slice(0, 5).map((src, i) => (
                <span key={i} className="source-tag">
                  {src.filename || src.docName}
                  {(src.pageNumber || src.page) && ` (p.${src.pageNumber || src.page})`}
                </span>
              ))}
            </div>
          )}

          {/* Guard warning */}
          {msg.blocked && (
            <div className="ai-message-warning">
              ⚠️ This response was limited for accuracy reasons.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ai-assistant-module">
      {/* Header */}
      <div className="ai-header">
        <h2>🤖 CEW AI Assistant</h2>
        <div className={`ai-status ${serviceStatus}`}>
          <span className="status-dot"></span>
          {serviceStatus === 'online' ? 'Online' : serviceStatus === 'checking' ? 'Connecting...' : 'Offline'}
        </div>
      </div>

      {/* Info banner */}
      <div className="ai-info-banner">
        <span>💡</span>
        <span>Ask questions about project documents, specifications, BOMs, and technical details. I only answer based on uploaded documents.</span>
      </div>

      {/* Messages */}
      <div className="ai-messages">
        {messages.map(renderMessage)}
        
        {loading && (
          <div className="ai-message assistant loading">
            <div className="ai-message-avatar">🤖</div>
            <div className="ai-message-content">
              <div className="ai-typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form className="ai-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about project documents..."
          disabled={loading || serviceStatus === 'offline'}
        />
        <button type="submit" disabled={loading || !input.trim() || serviceStatus === 'offline'}>
          {loading ? '...' : 'Send'}
        </button>
      </form>

      {/* Offline warning */}
      {serviceStatus === 'offline' && (
        <div className="ai-offline-warning">
          ⚠️ AI Service is offline. Run <code>node src/server.js</code> in ai-service folder.
          <button onClick={checkServiceHealth}>Retry</button>
        </div>
      )}
    </div>
  );
}
