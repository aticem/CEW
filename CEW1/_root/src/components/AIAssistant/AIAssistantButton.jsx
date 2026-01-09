/**
 * AIAssistantButton Component
 * Floating action button (FAB) to toggle the AI chat panel
 */

export default function AIAssistantButton({ isOpen, onClick, hasNewMessage }) {
  return (
    <button
      type="button"
      className={`ai-fab ${isOpen ? 'active' : ''}`}
      onClick={onClick}
      aria-label={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
      title={isOpen ? 'Close AI Assistant' : 'Ask AI Assistant'}
    >
      <span className="ai-fab-icon">
        {isOpen ? '✕' : '🤖'}
      </span>
      
      {/* Notification badge for new messages */}
      {!isOpen && hasNewMessage && (
        <span className="ai-fab-badge">!</span>
      )}
    </button>
  );
}
