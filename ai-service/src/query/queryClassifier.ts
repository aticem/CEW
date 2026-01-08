import { QueryType } from '../types';
import { logger } from '../services/logger';

export interface ClassificationResult {
  queryType: QueryType;
  confidence: number;
  suggestedFilters?: {
    documentTypes?: string[];
    keywords?: string[];
  };
}

class QueryClassifier {
  private documentKeywords = [
    'document', 'file', 'pdf', 'report', 'specification', 'spec',
    'drawing', 'plan', 'manual', 'guide', 'procedure', 'policy',
    'contract', 'agreement', 'submittal', 'rfi', 'change order',
  ];

  private dataKeywords = [
    'data', 'number', 'value', 'calculate', 'sum', 'total', 'average',
    'count', 'quantity', 'measurement', 'dimension', 'cost', 'price',
    'date', 'schedule', 'timeline', 'percentage', 'ratio', 'compare',
  ];

  private conversationalKeywords = [
    'hello', 'hi', 'thanks', 'thank', 'help', 'can you', 'could you',
    'please', 'what is', 'explain', 'tell me about', 'how does',
  ];

  classify(query: string): ClassificationResult {
    const normalizedQuery = query.toLowerCase().trim();

    // Check for conversational queries first
    if (this.isConversational(normalizedQuery)) {
      return {
        queryType: 'conversational',
        confidence: 0.9,
      };
    }

    // Score for document-focused query
    const docScore = this.scoreKeywords(normalizedQuery, this.documentKeywords);

    // Score for data-focused query
    const dataScore = this.scoreKeywords(normalizedQuery, this.dataKeywords);

    // Determine query type
    let queryType: QueryType;
    let confidence: number;

    if (docScore > 0.3 && dataScore > 0.3) {
      queryType = 'hybrid';
      confidence = Math.min(docScore, dataScore);
    } else if (docScore > dataScore) {
      queryType = 'document';
      confidence = docScore;
    } else if (dataScore > docScore) {
      queryType = 'data';
      confidence = dataScore;
    } else {
      // Default to document query
      queryType = 'document';
      confidence = 0.5;
    }

    const result: ClassificationResult = {
      queryType,
      confidence,
      suggestedFilters: this.extractFilters(normalizedQuery),
    };

    logger.debug('Query classified', {
      query: query.slice(0, 50),
      queryType,
      confidence,
    });

    return result;
  }

  private isConversational(query: string): boolean {
    const conversationalScore = this.scoreKeywords(query, this.conversationalKeywords);

    // Also check for very short queries or greetings
    if (query.length < 20 || /^(hi|hello|hey|thanks|thank you)[\s!.]*$/i.test(query)) {
      return true;
    }

    return conversationalScore > 0.5;
  }

  private scoreKeywords(query: string, keywords: string[]): number {
    let matches = 0;
    const words = query.split(/\s+/);

    for (const keyword of keywords) {
      if (query.includes(keyword)) {
        matches++;
      }
    }

    // Normalize score
    return Math.min(matches / 3, 1);
  }

  private extractFilters(query: string): ClassificationResult['suggestedFilters'] {
    const filters: ClassificationResult['suggestedFilters'] = {};

    // Extract document type hints
    const docTypePatterns: Record<string, string[]> = {
      pdf: ['pdf', 'document'],
      docx: ['word', 'docx', 'document'],
      xlsx: ['excel', 'spreadsheet', 'xlsx', 'xls'],
      txt: ['text', 'txt'],
    };

    const suggestedTypes: string[] = [];
    for (const [type, patterns] of Object.entries(docTypePatterns)) {
      if (patterns.some((p) => query.includes(p))) {
        suggestedTypes.push(type);
      }
    }

    if (suggestedTypes.length > 0) {
      filters.documentTypes = suggestedTypes;
    }

    // Extract potential keywords/topics
    const keywords = this.extractKeywords(query);
    if (keywords.length > 0) {
      filters.keywords = keywords;
    }

    return Object.keys(filters).length > 0 ? filters : undefined;
  }

  private extractKeywords(query: string): string[] {
    // Extract nouns and important terms (simplified)
    const words = query.split(/\s+/);
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'what',
      'where', 'when', 'how', 'which', 'who', 'can', 'could', 'would', 'should',
      'find', 'show', 'tell', 'me', 'about', 'please', 'get', 'give',
    ]);

    return words
      .filter((word) => word.length > 3)
      .filter((word) => !stopWords.has(word.toLowerCase()))
      .slice(0, 5);
  }

  getQueryTypeDescription(queryType: QueryType): string {
    const descriptions: Record<QueryType, string> = {
      document: 'Search for information within documents',
      data: 'Extract or calculate specific data values',
      hybrid: 'Combination of document search and data extraction',
      conversational: 'General conversation or help request',
    };

    return descriptions[queryType];
  }
}

export const queryClassifier = new QueryClassifier();
