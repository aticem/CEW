/**
 * SourceReference Component
 * Renders a clickable badge/chip for document sources
 */

export default function SourceReference({ source }) {
  if (!source) return null;

  const filename = source.filename || source.docName || 'Unknown';
  const pageNumber = source.pageNumber || source.page;
  const score = source.relevanceScore || source.score;

  // Truncate long filenames
  const displayName = filename.length > 20 
    ? filename.slice(0, 18) + '...' 
    : filename;

  const handleClick = () => {
    // Could open document viewer or show more details
    console.log('Source clicked:', source);
  };

  return (
    <button 
      type="button"
      className="source-ref"
      onClick={handleClick}
      title={filename}
    >
      <span className="source-ref-icon">📄</span>
      <span className="source-ref-name">{displayName}</span>
      {pageNumber && (
        <span className="source-ref-page">p.{pageNumber}</span>
      )}
      {score && score < 1 && (
        <span className="source-ref-score">
          {Math.round(score * 100)}%
        </span>
      )}
    </button>
  );
}
