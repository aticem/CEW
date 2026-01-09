/**
 * ChatMessage Component
 * Renders a single chat message (user or assistant)
 */

import SourceReference from './SourceReference';

export default function ChatMessage({ message }) {
  const { role, content, sources, timestamp, error } = message;
  const isUser = role === 'user';

  // Format timestamp
  const formatTime = (ts) => {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`chat-message ${role} ${error ? 'error' : ''}`}>
      <div className="chat-message-avatar">
        {isUser ? '👤' : '🤖'}
      </div>
      
      <div className="chat-message-content">
        <div className="chat-message-bubble">
          {content}
        </div>
        
        {/* Source references for assistant messages */}
        {!isUser && sources && sources.length > 0 && (
          <div className="chat-message-sources">
            {sources.slice(0, 5).map((source, idx) => (
              <SourceReference key={idx} source={source} />
            ))}
          </div>
        )}
        
        {/* Timestamp */}
        {timestamp && (
          <div className="chat-message-time">
            {formatTime(timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Loading message indicator
 */
export function LoadingMessage() {
  return (
    <div className="chat-message assistant">
      <div className="chat-message-avatar">🤖</div>
      <div className="chat-message-content">
        <div className="chat-message-bubble">
          <div className="chat-message-loading">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
