import { DocumentMetadata, DocumentSource } from '../types';
import { config } from '../config';
import { logger } from '../services/logger';

export interface QAQCDocument {
  id: string;
  name: string;
  type: string;
  url: string;
  projectId: string;
  category: string;
  uploadedAt: Date;
  metadata: Record<string, unknown>;
}

export interface QAQCSearchParams {
  projectId?: string;
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
  searchTerm?: string;
  limit?: number;
  offset?: number;
}

class CEWQAQCConnector {
  private apiUrl: string;
  private apiKey: string;
  private initialized: boolean = false;

  constructor() {
    this.apiUrl = config.cew.apiUrl;
    this.apiKey = config.cew.apiKey;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      logger.warn('CEW QA/QC connector not configured - API key missing');
      return;
    }

    try {
      const healthy = await this.checkConnection();
      if (healthy) {
        this.initialized = true;
        logger.info('CEW QA/QC connector initialized', { apiUrl: this.apiUrl });
      } else {
        logger.warn('CEW QA/QC connector could not connect to API');
      }
    } catch (error) {
      logger.error('Failed to initialize CEW QA/QC connector', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/health`, {
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listDocuments(params?: QAQCSearchParams): Promise<QAQCDocument[]> {
    if (!this.initialized) {
      throw new Error('CEW QA/QC connector not initialized');
    }

    try {
      const queryParams = new URLSearchParams();
      if (params?.projectId) queryParams.set('projectId', params.projectId);
      if (params?.category) queryParams.set('category', params.category);
      if (params?.dateFrom) queryParams.set('dateFrom', params.dateFrom.toISOString());
      if (params?.dateTo) queryParams.set('dateTo', params.dateTo.toISOString());
      if (params?.searchTerm) queryParams.set('search', params.searchTerm);
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.offset) queryParams.set('offset', params.offset.toString());

      const response = await fetch(
        `${this.apiUrl}/api/documents?${queryParams.toString()}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.documents as QAQCDocument[];
    } catch (error) {
      logger.error('Failed to list CEW QA/QC documents', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async getDocument(documentId: string): Promise<QAQCDocument | null> {
    if (!this.initialized) {
      throw new Error('CEW QA/QC connector not initialized');
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/api/documents/${documentId}`,
        { headers: this.getHeaders() }
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to get CEW QA/QC document', {
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async downloadDocument(documentId: string): Promise<Buffer> {
    if (!this.initialized) {
      throw new Error('CEW QA/QC connector not initialized');
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/api/documents/${documentId}/download`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error('Failed to download CEW QA/QC document', {
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async syncDocuments(params?: QAQCSearchParams): Promise<{
    synced: number;
    failed: number;
    errors: Array<{ id: string; error: string }>;
  }> {
    const result = { synced: 0, failed: 0, errors: [] as Array<{ id: string; error: string }> };

    try {
      const documents = await this.listDocuments(params);

      for (const doc of documents) {
        try {
          // Download and process document
          const buffer = await this.downloadDocument(doc.id);
          // Here you would save the buffer and process it
          // This is a placeholder for the actual sync logic
          result.synced++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            id: doc.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info('CEW QA/QC sync completed', result);
      return result;
    } catch (error) {
      logger.error('CEW QA/QC sync failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async getCategories(): Promise<string[]> {
    if (!this.initialized) {
      throw new Error('CEW QA/QC connector not initialized');
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/categories`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.categories;
    } catch (error) {
      logger.error('Failed to get CEW QA/QC categories', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async getProjects(): Promise<Array<{ id: string; name: string }>> {
    if (!this.initialized) {
      throw new Error('CEW QA/QC connector not initialized');
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/projects`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.projects;
    } catch (error) {
      logger.error('Failed to get CEW projects', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const cewQAQCConnector = new CEWQAQCConnector();
