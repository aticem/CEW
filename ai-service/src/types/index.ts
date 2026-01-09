/**
 * Core TypeScript type definitions for CEW AI Service
 * @module types
 */

// ============================================================================
// Document Types
// ============================================================================

/**
 * Supported document file types for ingestion
 */
export type FileType = 'pdf' | 'docx' | 'xlsx' | 'txt' | 'csv' | 'image' | 'unknown';

/**
 * Metadata associated with an ingested document
 * @description Contains all identifying and descriptive information about a document
 */
export interface DocumentMetadata {
  /**
   * Unique identifier for the document
   * @example "doc_abc123"
   */
  id: string;

  /**
   * Original filename including extension
   * @example "QAQC_Checklist_2024.pdf"
   */
  filename: string;

  /**
   * Absolute or relative path to the document
   * @example "/documents/qaqc/QAQC_Checklist_2024.pdf"
   */
  filePath: string;

  /**
   * Detected or inferred file type
   */
  fileType: FileType;

  /**
   * File size in bytes
   */
  sizeBytes: number;

  /**
   * Total number of pages (for paginated documents)
   */
  pageCount?: number;

  /**
   * Document title extracted from content or filename
   */
  title?: string;

  /**
   * Document author if available
   */
  author?: string;

  /**
   * Categorization label for the document
   * @example "qaqc", "procedure", "checklist"
   */
  category?: string;

  /**
   * User-defined tags for filtering and search
   */
  tags?: string[];

  /**
   * ISO 8601 timestamp when document was ingested
   */
  ingestedAt: string;

  /**
   * ISO 8601 timestamp of document's last modification
   */
  lastModified?: string;

  /**
   * Hash of document content for deduplication
   */
  contentHash?: string;
}

/**
 * A chunk of document content with associated metadata
 * @description Represents a segment of a document after chunking for embedding
 */
export interface DocumentChunk {
  /**
   * Unique identifier for this chunk
   * @example "chunk_abc123_0"
   */
  id: string;

  /**
   * Reference to the parent document ID
   */
  documentId: string;

  /**
   * The actual text content of this chunk
   */
  content: string;

  /**
   * Zero-based index of this chunk within the document
   */
  chunkIndex: number;

  /**
   * Page number where this chunk originates (1-based)
   */
  pageNumber?: number;

  /**
   * Character offset where this chunk starts in the original document
   */
  startOffset: number;

  /**
   * Character offset where this chunk ends in the original document
   */
  endOffset: number;

  /**
   * Section headings that apply to this chunk
   */
  headings?: string[];

  /**
   * Vector embedding for this chunk (typically 1536 dimensions for OpenAI)
   */
  embedding?: number[];

  /**
   * Token count for this chunk
   */
  tokenCount?: number;
}

/**
 * Result of parsing a document
 * @description Contains extracted content and metadata after document processing
 */
export interface ParsedDocument {
  /**
   * Generated metadata for the document
   */
  metadata: DocumentMetadata;

  /**
   * Full extracted text content
   */
  content: string;

  /**
   * Document split into chunks ready for embedding
   */
  chunks: DocumentChunk[];

  /**
   * Extracted structural elements (headings, tables, etc.)
   */
  structure?: {
    /**
     * Document headings with their hierarchy level
     */
    headings?: Array<{ level: number; text: string; pageNumber?: number }>;

    /**
     * Extracted tables as 2D string arrays
     */
    tables?: Array<{ pageNumber?: number; rows: string[][] }>;
  };

  /**
   * Any warnings generated during parsing
   */
  warnings?: string[];
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Classification of query intent
 * @description Determines how the query should be processed
 * - `document`: Query targets document content (RAG retrieval)
 * - `data`: Query targets structured data (database/API)
 * - `hybrid`: Query requires both document and data sources
 */
export type QueryType = 'document' | 'data' | 'hybrid';

/**
 * User query with all associated parameters
 * @description Represents a complete query request from the user
 */
export interface UserQuery {
  /**
   * The natural language query text
   * @example "What are the inspection requirements for DC cable testing?"
   */
  text: string;

  /**
   * Classified query type (may be auto-detected)
   */
  type?: QueryType;

  /**
   * Conversation ID for multi-turn context
   */
  conversationId?: string;

  /**
   * Maximum number of source documents to retrieve
   * @default 5
   */
  maxSources?: number;

  /**
   * Minimum relevance score threshold (0-1)
   * @default 0.7
   */
  minRelevance?: number;

  /**
   * Filter results by document categories
   */
  categories?: string[];

  /**
   * Filter results by specific document IDs
   */
  documentIds?: string[];

  /**
   * Filter by date range (ISO 8601 strings)
   */
  dateRange?: {
    /** Start date (inclusive) */
    start?: string;
    /** End date (inclusive) */
    end?: string;
  };

  /**
   * User ID for access control and personalization
   */
  userId?: string;
}

/**
 * Result of processing a user query
 * @description Contains the generated answer and supporting information
 */
export interface QueryResult {
  /**
   * The generated answer text
   */
  answer: string;

  /**
   * Sources that contributed to the answer
   */
  sources: Source[];

  /**
   * Confidence score for the answer (0-1)
   * @description Higher values indicate greater confidence in answer accuracy
   */
  confidence: number;

  /**
   * Detected query type that was used for processing
   */
  queryType: QueryType;

  /**
   * Total processing time in milliseconds
   */
  processingTimeMs: number;

  /**
   * Token usage statistics
   */
  usage?: {
    /** Tokens used in the prompt */
    promptTokens: number;
    /** Tokens used in the completion */
    completionTokens: number;
    /** Total tokens used */
    totalTokens: number;
  };

  /**
   * Whether the response was truncated due to length limits
   */
  truncated?: boolean;

  /**
   * Model used to generate the response
   */
  model?: string;
}

// ============================================================================
// Source Types
// ============================================================================

/**
 * Base properties shared by all source types
 */
interface BaseSource {
  /**
   * Unique identifier for the source
   */
  id: string;

  /**
   * Relevance score for this source (0-1)
   */
  relevanceScore: number;
}

/**
 * A document-based source reference
 * @description Points to a specific location in an ingested document
 */
export interface DocumentSource extends BaseSource {
  /**
   * Discriminator for source type
   */
  type: 'document';

  /**
   * Reference to the document ID
   */
  documentId: string;

  /**
   * Original document filename
   */
  filename: string;

  /**
   * Page number where the relevant content is found (1-based)
   */
  pageNumber?: number;

  /**
   * Section or heading where the content is located
   */
  section?: string;

  /**
   * Relevant excerpt from the document
   */
  excerpt: string;

  /**
   * Character range in the original document
   */
  charRange?: {
    start: number;
    end: number;
  };

  /**
   * Document category
   */
  category?: string;
}

/**
 * A structured data source reference
 * @description Points to data retrieved from databases or APIs
 */
export interface DataSource extends BaseSource {
  /**
   * Discriminator for source type
   */
  type: 'data';

  /**
   * Name of the data source (table, API, etc.)
   * @example "project_progress", "equipment_inventory"
   */
  sourceName: string;

  /**
   * Human-readable label for the data source
   */
  label: string;

  /**
   * The actual data payload
   */
  data: Record<string, unknown>;

  /**
   * Query or filter used to retrieve this data
   */
  query?: string;

  /**
   * ISO 8601 timestamp of when data was retrieved
   */
  retrievedAt: string;
}

/**
 * Union type for all source types
 * @description Use discriminated union pattern with `type` field
 * @example
 * ```typescript
 * function handleSource(source: Source) {
 *   if (source.type === 'document') {
 *     console.log(source.filename); // DocumentSource
 *   } else {
 *     console.log(source.sourceName); // DataSource
 *   }
 * }
 * ```
 */
export type Source = DocumentSource | DataSource;

// ============================================================================
// API Types
// ============================================================================

/**
 * Chat API request payload
 * @description Sent by clients to the /api/chat endpoint
 */
export interface ChatRequest {
  /**
   * The user's message or query
   */
  message: string;

  /**
   * Conversation ID for maintaining context across turns
   * @description If omitted, starts a new conversation
   */
  conversationId?: string;

  /**
   * Classified query type (optional, will be auto-detected if not provided)
   */
  queryType?: QueryType;

  /**
   * Whether to stream the response
   * @default false
   */
  stream?: boolean;

  /**
   * Maximum number of sources to include
   * @default 5
   */
  maxSources?: number;

  /**
   * Filter configuration
   */
  filters?: {
    /** Filter by document categories */
    categories?: string[];
    /** Filter by specific document IDs */
    documentIds?: string[];
    /** Filter by date range */
    dateRange?: {
      start?: string;
      end?: string;
    };
  };

  /**
   * Model configuration overrides
   */
  modelConfig?: {
    /** Temperature for response generation (0-2) */
    temperature?: number;
    /** Maximum tokens in the response */
    maxTokens?: number;
  };
}

/**
 * Chat API response payload
 * @description Returned by the /api/chat endpoint
 */
export interface ChatResponse {
  /**
   * Whether the request was successful
   */
  success: boolean;

  /**
   * The generated response message
   */
  message: string;

  /**
   * Conversation ID (generated if new conversation)
   */
  conversationId: string;

  /**
   * Sources that contributed to the response
   */
  sources: Source[];

  /**
   * Detected or provided query type
   */
  queryType: QueryType;

  /**
   * Confidence score for the response (0-1)
   */
  confidence: number;

  /**
   * Processing metrics
   */
  metrics: {
    /** Total processing time in milliseconds */
    processingTimeMs: number;
    /** Number of chunks retrieved */
    chunksRetrieved: number;
    /** Token usage */
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };

  /**
   * Error information (only present if success is false)
   */
  error?: {
    /** Error code for programmatic handling */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Additional error details */
    details?: Record<string, unknown>;
  };

  /**
   * ISO 8601 timestamp of response generation
   */
  timestamp: string;
}

// ============================================================================
// Config Types
// ============================================================================

/**
 * Application configuration
 * @description Central configuration interface for the AI service
 */
export interface AppConfig {
  /**
   * Server configuration
   */
  server: {
    /** Port to listen on */
    port: number;
    /** Environment (development, staging, production) */
    env: 'development' | 'staging' | 'production';
    /** Enable CORS */
    corsEnabled: boolean;
    /** Allowed CORS origins */
    corsOrigins?: string[];
  };

  /**
   * OpenAI configuration
   */
  openai: {
    /** OpenAI API key */
    apiKey: string;
    /** Model for chat completions */
    chatModel: string;
    /** Model for embeddings */
    embeddingModel: string;
    /** Default temperature */
    temperature: number;
    /** Maximum tokens per request */
    maxTokens: number;
  };

  /**
   * Vector store configuration
   */
  vectorStore: {
    /** Vector store provider (chromadb, faiss) */
    provider: 'chromadb' | 'faiss';
    /** Collection/index name */
    collectionName: string;
    /** Path for persistent storage */
    persistPath: string;
    /** ChromaDB host (if using chromadb) */
    chromaHost?: string;
    /** ChromaDB port (if using chromadb) */
    chromaPort?: number;
  };

  /**
   * Document processing configuration
   */
  documents: {
    /** Path to document storage */
    storagePath: string;
    /** Allowed file extensions */
    allowedExtensions: string[];
    /** Maximum file size in bytes */
    maxFileSizeBytes: number;
    /** Chunk size in characters */
    chunkSize: number;
    /** Chunk overlap in characters */
    chunkOverlap: number;
  };

  /**
   * CEW integration configuration
   */
  cew: {
    /** Path to CEW frontend */
    frontendPath: string;
    /** Path to QAQC documents */
    qaqcPath: string;
  };

  /**
   * Logging configuration
   */
  logging: {
    /** Log level */
    level: 'debug' | 'info' | 'warn' | 'error';
    /** Log file path (optional) */
    filePath?: string;
    /** Enable JSON format */
    jsonFormat: boolean;
  };

  /**
   * OCR configuration
   */
  ocr: {
    /** Enable OCR for scanned documents */
    enabled: boolean;
    /** Tesseract language */
    language: string;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Generic API response wrapper
 * @typeParam T - The type of the data payload
 */
export interface ApiResponse<T> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (present if success is true) */
  data?: T;
  /** Error details (present if success is false) */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Service version */
  version: string;
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** Individual service statuses */
  services: {
    /** LLM service availability */
    llm: boolean;
    /** Vector store availability */
    vectorStore: boolean;
    /** OCR service availability */
    ocr: boolean;
  };
}

/**
 * Ingestion request payload
 */
export interface IngestRequest {
  /** Single file path to ingest */
  filePath?: string;
  /** Directory path to ingest (all matching files) */
  directoryPath?: string;
  /** Recursively scan subdirectories */
  recursive?: boolean;
  /** Filter by file extensions */
  fileTypes?: FileType[];
  /** Category to assign to ingested documents */
  category?: string;
  /** Tags to assign to ingested documents */
  tags?: string[];
}

/**
 * Ingestion result
 */
export interface IngestResult {
  /** Whether ingestion completed successfully */
  success: boolean;
  /** Number of documents processed */
  documentsProcessed: number;
  /** Number of chunks created */
  chunksCreated: number;
  /** Total tokens embedded */
  tokensEmbedded: number;
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Errors encountered during ingestion */
  errors: Array<{
    filePath: string;
    error: string;
  }>;
}
