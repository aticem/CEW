/**
 * Core type definitions for the CEW AI Service
 */

/**
 * Metadata associated with a document
 */
export interface DocumentMetadata {
  /** Unique document identifier */
  id: string;
  /** Original filename */
  filename: string;
  /** Full file path */
  filepath: string;
  /** File type (pdf, docx, xlsx, txt) */
  fileType: string;
  /** File size in bytes */
  fileSize: number;
  /** Date when document was ingested */
  ingestedAt: Date;
  /** Number of pages in the document */
  pageCount?: number;
  /** Whether OCR was applied */
  ocrApplied: boolean;
  /** Language detected in the document */
  language?: string;
  /** Custom metadata tags */
  tags?: string[];
  /** Source system or category */
  source?: string;
}

/**
 * A chunk of text extracted from a document
 */
export interface DocumentChunk {
  /** Unique chunk identifier */
  id: string;
  /** Document this chunk belongs to */
  documentId: string;
  /** The actual text content */
  content: string;
  /** Embedding vector for this chunk */
  embedding?: number[];
  /** Page number where this chunk appears */
  pageNumber?: number;
  /** Section or heading information */
  section?: string;
  /** Character position in original document */
  startIndex: number;
  /** End character position */
  endIndex: number;
  /** Metadata inherited from parent document */
  metadata: DocumentMetadata;
}

/**
 * Result of document parsing operation
 */
export interface ParsedDocument {
  /** Extracted text content */
  text: string;
  /** Document metadata */
  metadata: DocumentMetadata;
  /** Number of pages processed */
  pageCount?: number;
  /** Whether OCR was applied */
  ocrApplied: boolean;
  /** Any warnings during parsing */
  warnings?: string[];
}

/**
 * Types of queries the system can handle
 */
export enum QueryType {
  /** Query about document content */
  DOCUMENT = 'DOCUMENT',
  /** Query requiring database access */
  DATA = 'DATA',
  /** Greeting or general conversation */
  GENERAL = 'GENERAL',
  /** Query outside system scope */
  OUT_OF_SCOPE = 'OUT_OF_SCOPE'
}

/**
 * User query with classification
 */
export interface UserQuery {
  /** The query text */
  query: string;
  /** Classified query type */
  type: QueryType;
  /** Detected language (en, tr) */
  language: string;
  /** Confidence score for classification */
  confidence: number;
  /** Extracted parameters or entities */
  parameters?: Record<string, any>;
}

/**
 * Request payload for chat endpoint
 */
export interface ChatRequest {
  /** User's question */
  query: string;
  /** Optional conversation ID for context */
  conversationId?: string;
  /** Optional user ID for tracking */
  userId?: string;
  /** Optional language hint */
  language?: string;
}

/**
 * Source reference for an answer
 */
export interface Source {
  /** Document ID */
  documentId: string;
  /** Document filename */
  filename: string;
  /** Page number if applicable */
  pageNumber?: number;
  /** Relevant text excerpt */
  excerpt: string;
  /** Similarity score */
  relevanceScore: number;
}

/**
 * Response from chat endpoint
 */
export interface ChatResponse {
  /** Generated answer */
  answer: string;
  /** Sources used to generate the answer */
  sources: Source[];
  /** Query classification */
  queryType: QueryType;
  /** Language of the response */
  language: string;
  /** Confidence in the answer */
  confidence: number;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Token usage information */
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Any warnings or notices */
  warnings?: string[];
}

/**
 * Application configuration
 */
export interface AppConfig {
  /** Server port */
  port: number;
  /** Node environment */
  nodeEnv: string;
  /** OpenAI API key */
  openaiApiKey: string;
  /** Vector store type */
  vectorStore: 'chroma' | 'faiss' | 'local';
  /** Vector store URL (for Chroma) */
  chromaUrl?: string;
  /** Vector store file path */
  vectorStorePath: string;
  /** Text chunk size */
  chunkSize: number;
  /** Chunk overlap */
  chunkOverlap: number;
  /** Maximum retrieval results */
  maxRetrievalResults: number;
  /** Embedding model name */
  embeddingModel: string;
  /** Embedding dimensions */
  embeddingDimensions: number;
  /** LLM model name */
  llmModel: string;
  /** LLM temperature */
  llmTemperature: number;
  /** Maximum tokens for LLM */
  maxTokens: number;
  /** OCR languages */
  ocrLanguages: string;
  /** Log level */
  logLevel: string;
  /** Log file path */
  logFile: string;
  /** Documents directory */
  documentsPath: string;
  /** Registry file path */
  registryPath: string;
}

/**
 * Document ingestion result
 */
export interface IngestionResult {
  /** Whether ingestion was successful */
  success: boolean;
  /** Document ID if successful */
  documentId?: string;
  /** Document metadata */
  metadata?: DocumentMetadata;
  /** Number of chunks created */
  chunksCreated: number;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Error message if failed */
  error?: string;
  /** Any warnings */
  warnings?: string[];
}

/**
 * Vector search result
 */
export interface SearchResult {
  /** The matching chunk */
  chunk: DocumentChunk;
  /** Similarity score (0-1) */
  score: number;
  /** Distance metric (lower is better) */
  distance: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  /** Service status */
  status: 'healthy' | 'unhealthy';
  /** Timestamp */
  timestamp: Date;
  /** Vector store status */
  vectorStore: {
    connected: boolean;
    documentCount: number;
    chunkCount: number;
  };
  /** OpenAI API status */
  openai: {
    connected: boolean;
  };
  /** Service uptime in seconds */
  uptime: number;
}
