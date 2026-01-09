/**
 * Query Classifier - Classifies user queries and detects language
 */
import { UserQuery, QueryType } from '../types';
import { logger } from '../services/logger';

/**
 * Query Classifier class
 */
export class QueryClassifier {
  /**
   * Classify a user query
   * @param query - The user's query text
   * @returns Classified query with metadata
   */
  classifyQuery(query: string): UserQuery {
    const trimmedQuery = query.trim();
    
    // Detect language
    const language = this.detectLanguage(trimmedQuery);
    
    // Classify query type
    const { type, confidence } = this.classifyType(trimmedQuery, language);
    
    logger.debug('Query classified', {
      type,
      language,
      confidence,
      queryLength: trimmedQuery.length
    });

    return {
      query: trimmedQuery,
      type,
      language,
      confidence
    };
  }

  /**
   * Detect the language of the query
   * @param query - The query text
   * @returns Language code (en or tr)
   */
  private detectLanguage(query: string): string {
    // Simple heuristic-based language detection
    const turkishChars = /[çğıöşüÇĞİÖŞÜ]/;
    const turkishWords = /\b(nedir|nasıl|ne|nerede|kim|hangi|için|hakkında|var|yok|mı|mi|mu|mü)\b/i;
    
    if (turkishChars.test(query) || turkishWords.test(query)) {
      return 'tr';
    }
    
    return 'en';
  }

  /**
   * Classify the type of query
   * @param query - The query text
   * @param language - Detected language
   * @returns Query type and confidence
   */
  private classifyType(query: string, language: string): {
    type: QueryType;
    confidence: number;
  } {
    const lowerQuery = query.toLowerCase();

    // Check for greetings
    if (this.isGreeting(lowerQuery, language)) {
      return { type: QueryType.GENERAL, confidence: 0.95 };
    }

    // Check for DATA queries (database/statistics requests)
    if (this.isDataQuery(lowerQuery, language)) {
      return { type: QueryType.DATA, confidence: 0.85 };
    }

    // Check for out-of-scope queries
    if (this.isOutOfScope(lowerQuery, language)) {
      return { type: QueryType.OUT_OF_SCOPE, confidence: 0.8 };
    }

    // Default to DOCUMENT query (RAG-based)
    return { type: QueryType.DOCUMENT, confidence: 0.9 };
  }

  /**
   * Check if query is a greeting
   */
  private isGreeting(query: string, language: string): boolean {
    const englishGreetings = [
      'hello', 'hi', 'hey', 'greetings',
      'good morning', 'good afternoon', 'good evening'
    ];
    
    const turkishGreetings = [
      'merhaba', 'selam', 'günaydın', 'iyi günler',
      'iyi akşamlar', 'hey', 'selamlar'
    ];

    const greetings = language === 'tr' ? turkishGreetings : englishGreetings;
    
    // Check if query is just a greeting (very short)
    if (query.length < 50) {
      return greetings.some(greeting => query.includes(greeting));
    }

    return false;
  }

  /**
   * Check if query requires database access
   */
  private isDataQuery(query: string, language: string): boolean {
    const dataKeywords = {
      en: [
        'how many', 'count', 'total number', 'statistics',
        'show me all', 'list all', 'database', 'query',
        'latest data', 'current status', 'real-time'
      ],
      tr: [
        'kaç tane', 'toplam', 'sayısı', 'istatistik',
        'hepsini göster', 'listele', 'veritabanı',
        'güncel veri', 'son durum', 'anlık'
      ]
    };

    const keywords = dataKeywords[language as 'en' | 'tr'] || dataKeywords.en;
    
    return keywords.some(keyword => query.includes(keyword));
  }

  /**
   * Check if query is out of scope
   */
  private isOutOfScope(query: string, language: string): boolean {
    const outOfScopeKeywords = {
      en: [
        'weather', 'news', 'stock price', 'movie', 'recipe',
        'song', 'game', 'joke', 'story',
        'what is your name', 'who created you', 'who are you'
      ],
      tr: [
        'hava durumu', 'haber', 'borsa', 'film', 'tarif',
        'şarkı', 'oyun', 'fıkra', 'hikaye',
        'adın ne', 'kim yarattı', 'kimsin'
      ]
    };

    const keywords = outOfScopeKeywords[language as 'en' | 'tr'] || outOfScopeKeywords.en;
    
    return keywords.some(keyword => query.includes(keyword));
  }

  /**
   * Extract potential parameters from query
   * (For future use with structured queries)
   */
  extractParameters(query: string): Record<string, any> {
    const parameters: Record<string, any> = {};
    
    // Extract numbers
    const numbers = query.match(/\d+/g);
    if (numbers) {
      parameters.numbers = numbers.map(n => parseInt(n));
    }

    // Extract dates (basic pattern)
    const datePattern = /\d{4}-\d{2}-\d{2}/g;
    const dates = query.match(datePattern);
    if (dates) {
      parameters.dates = dates;
    }

    return parameters;
  }
}

// Singleton instance
export const queryClassifier = new QueryClassifier();
export default queryClassifier;
