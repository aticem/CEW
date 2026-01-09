/**
 * AI Service Configuration
 * Single source of truth for AI backend URL
 */

// Development: Local AI service
// Production: Could be changed to deployed URL
const AI_SERVICE_BASE_URL = 'http://localhost:3001';

export const AI_CONFIG = {
  baseUrl: AI_SERVICE_BASE_URL,
  endpoints: {
    health: `${AI_SERVICE_BASE_URL}/health`,
    chat: `${AI_SERVICE_BASE_URL}/api/chat`,
    ingest: `${AI_SERVICE_BASE_URL}/api/ingest`,
    documents: `${AI_SERVICE_BASE_URL}/api/documents`,
  },
  timeout: 30000, // 30 seconds
};

export default AI_CONFIG;
