// ============================================================================
// Document Types
// ============================================================================

/**
 * Supported document file types for ingestion
 */
export type DocumentFileType = 'pdf' | 'docx' | 'xlsx' | 'txt' | 'csv';

/**
 * Origin of the document - either local documents folder or CEW QA/QC system
 */
export type DocumentSourceType = 'local_documents' | 'cew_qaqc';

/**
 * Metadata associated with an ingested document
 */
export interface DocumentMetadata {
  /** Unique identifier for the document */
  id: string;

  /** Original filename of the document */
  filename: string;

  /** Source system where the document originated */
  source: DocumentSourceType;

  /** Logical path within the source system (e.g., "projects/bridge-01/specs") */
  logicalPath: string;

  /** File type/extension */
  filetype: DocumentFileType;

  /** Timestamp when the document was first ingested */
  createdAt: Date;

  /** Timestamp when the document was last updated/re-indexed */
  updatedAt: Date;

  /** Number of pages (for PDF/DOCX) or sheets (for XLSX) */
  pageCount?: number;
}

/**
 * Metadata for a specific chunk within a document
 */
export interface ChunkMetadata {
  /** Page number (1-indexed) for PDF/DOCX, or sheet number for XLSX */
  pageNumber?: number;

  /** Sheet name for XLSX documents */
  sheetName?: string;

  /** Position/index of this chunk within the document */
  chunkIndex: number;

  /** Character offset where this chunk starts in the original document */
  startOffset: number;

  /** Character offset where this chunk ends in the original document */
  endOffset: number;

  /** Section headers that apply to this chunk */
  headers?: string[];
}

/**
 * A chunk of document content with its embedding vector
 */
export interface DocumentChunk {
  /** Unique identifier for the chunk */
  id: string;

  /** Reference to the parent document */
  documentId: string;

  /** Text content of the chunk */
  content: string;

  /** Positional and structural metadata */
  metadata: ChunkMetadata;

  /** Vector embedding for semantic search (OpenAI text-embedding-3-small: 1536 dimensions) */
  embedding: number[];
}

/**
 * A fully parsed document ready for indexing
 */
export interface ParsedDocument {
  /** Document metadata */
  metadata: DocumentMetadata;

  /** Array of content chunks extracted from the document */
  chunks: DocumentChunk[];
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Classification of query intent
 * - document: Search within document content
 * - data: Query structured data from CEW modules
 * - hybrid: Combination of document search and data query
 */
export type QueryType = 'document' | 'data' | 'hybrid';

/**
 * Supported languages for queries and responses
 */
export type Language = 'tr' | 'en';

/**
 * User query with metadata
 */
export interface UserQuery {
  /** The query text from the user */
  text: string;

  /** Detected or specified language of the query */
  language: Language;

  /** When the query was submitted */
  timestamp: Date;

  /** Session identifier for conversation continuity */
  sessionId: string;
}

/**
 * Result of processing a user query
 */
export interface QueryResult {
  /** Generated answer text */
  answer: string;

  /** Sources used to generate the answer */
  sources: Source[];

  /** Classification of the query type that was processed */
  queryType: QueryType;

  /** Confidence score (0-1) indicating answer reliability */
  confidence: number;
}

// ============================================================================
// Source Types
// ============================================================================

/**
 * Reference to a document used as a source
 */
export interface DocumentSource {
  /** Discriminator for source type */
  type: 'document';

  /** Name of the source file */
  filename: string;

  /** Page number where the information was found */
  page: number;

  /** Logical path to the document within the system */
  logicalPath: string;
}

/**
 * Reference to structured data from CEW modules
 */
export interface DataSource {
  /** Discriminator for source type */
  type: 'data';

  /** CEW module identifier (e.g., "qaqc", "inspection", "material") */
  moduleKey: string;

  /** Date range of the data queried */
  dateRange: {
    /** Start date of the data range */
    start: Date;
    /** End date of the data range */
    end: Date;
  };

  /** Human-readable description of the data source */
  description: string;
}

/**
 * Union type for all source references
 */
export type Source = DocumentSource | DataSource;

// ============================================================================
// Response Types (API)
// ============================================================================

/**
 * Incoming chat request from client
 */
export interface ChatRequest {
  /** User's message/question */
  message: string;

  /** Optional session ID for conversation continuity */
  sessionId?: string;

  /** Optional additional context to include in the query */
  context?: string;
}

/**
 * Chat response returned to client
 */
export interface ChatResponse {
  /** Generated answer to the user's question */
  answer: string;

  /** Sources referenced in generating the answer */
  sources: Source[];

  /** Language of the response */
  language: Language;

  /** Time taken to process the request in milliseconds */
  processingTime: number;
}

// ============================================================================
// Config Types
// ============================================================================

/**
 * Application configuration settings
 */
export interface AppConfig {
  /** HTTP server port number */
  port: number;

  /** OpenAI API key for embeddings and chat completions */
  openaiApiKey: string;

  /** Filesystem path to the documents storage directory */
  documentsPath: string;

  /** Filesystem path to the vector index storage directory */
  indexStorePath: string;

  /** Maximum size of text chunks in characters */
  maxChunkSize: number;

  /** Number of overlapping characters between adjacent chunks */
  chunkOverlap: number;
}

// ============================================================================
// Additional Utility Types
// ============================================================================

/**
 * Generic API response wrapper
 */
export interface APIResponse<T> {
  /** Whether the request was successful */
  success: boolean;

  /** Response payload (present on success) */
  data?: T;

  /** Error details (present on failure) */
  error?: APIError;

  /** Request metadata */
  metadata?: {
    /** Unique request identifier for tracing */
    requestId: string;
    /** Processing time in milliseconds */
    processingTimeMs: number;
  };
}

/**
 * API error details
 */
export interface APIError {
  /** Machine-readable error code */
  code: string;

  /** Human-readable error message */
  message: string;

  /** Additional error context */
  details?: Record<string, unknown>;
}

/**
 * Vector similarity search result
 */
export interface VectorSearchResult {
  /** The matched document chunk */
  chunk: DocumentChunk;

  /** Similarity score (higher is more similar) */
  score: number;
}

/**
 * Health check status for a service
 */
export interface ServiceHealth {
  /** Current service status */
  status: 'up' | 'down' | 'degraded';

  /** Response latency in milliseconds */
  latencyMs?: number;

  /** When the health check was performed */
  lastCheck: Date;

  /** Error message if status is not 'up' */
  error?: string;
}

/**
 * Overall system health status
 */
export interface HealthStatus {
  /** Aggregate system status */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Application version */
  version: string;

  /** Server uptime in seconds */
  uptime: number;

  /** Individual service health statuses */
  services: {
    vectorStore: ServiceHealth;
    llm: ServiceHealth;
    ocr: ServiceHealth;
  };
}

/**
 * Document ingestion progress tracking
 */
export interface IngestProgress {
  /** Document being processed */
  documentId: string;

  /** Current processing stage */
  status: 'pending' | 'processing' | 'embedding' | 'indexing' | 'completed' | 'failed';

  /** Progress percentage (0-100) */
  progress: number;

  /** Current status message */
  message?: string;

  /** Error message if status is 'failed' */
  error?: string;
}

/**
 * Result of document ingestion
 */
export interface IngestResult {
  /** ID of the ingested document */
  documentId: string;

  /** Original filename */
  filename: string;

  /** Number of chunks created */
  chunksCreated: number;

  /** Total processing time in milliseconds */
  processingTimeMs: number;

  /** Any warnings generated during processing */
  warnings?: string[];
}
