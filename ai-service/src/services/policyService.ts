import { PolicyValidation, PolicyViolation } from '../types';
import { logger } from './logger';

export interface PolicyConfig {
  maxQueryLength: number;
  minQueryLength: number;
  allowedLanguages: string[];
  blockedPatterns: RegExp[];
  maxFileSize: number;
}

class PolicyService {
  private config: PolicyConfig = {
    maxQueryLength: 5000,
    minQueryLength: 2,
    allowedLanguages: ['en', 'es', 'fr', 'de', 'pt'], // Add more as needed
    blockedPatterns: [
      /\b(password|secret|api[_-]?key|token)\s*[:=]/i,
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      /javascript:/gi,
    ],
    maxFileSize: 50 * 1024 * 1024, // 50MB
  };

  validateQuery(query: string): PolicyValidation {
    const violations: PolicyViolation[] = [];

    // Check query length
    if (query.length < this.config.minQueryLength) {
      violations.push({
        type: 'length',
        message: `Query is too short. Minimum length is ${this.config.minQueryLength} characters.`,
        severity: 'error',
      });
    }

    if (query.length > this.config.maxQueryLength) {
      violations.push({
        type: 'length',
        message: `Query is too long. Maximum length is ${this.config.maxQueryLength} characters.`,
        severity: 'error',
      });
    }

    // Check for blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(query)) {
        violations.push({
          type: 'content',
          message: 'Query contains potentially unsafe content.',
          severity: 'error',
        });
        break;
      }
    }

    // Check for injection attempts
    if (this.containsInjectionAttempt(query)) {
      violations.push({
        type: 'content',
        message: 'Query contains potential injection attempt.',
        severity: 'error',
      });
    }

    const isValid = violations.filter((v) => v.severity === 'error').length === 0;

    if (!isValid) {
      logger.warn('Query validation failed', {
        queryLength: query.length,
        violations: violations.map((v) => v.message),
      });
    }

    return { isValid, violations };
  }

  validateFileUpload(
    filename: string,
    fileSize: number,
    mimeType: string
  ): PolicyValidation {
    const violations: PolicyViolation[] = [];

    // Check file size
    if (fileSize > this.config.maxFileSize) {
      violations.push({
        type: 'length',
        message: `File size exceeds maximum allowed (${this.config.maxFileSize / 1024 / 1024}MB).`,
        severity: 'error',
      });
    }

    // Check allowed file types
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
      'text/csv',
    ];

    if (!allowedTypes.includes(mimeType)) {
      violations.push({
        type: 'format',
        message: `File type '${mimeType}' is not allowed.`,
        severity: 'error',
      });
    }

    // Check filename for suspicious patterns
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.js'];
    if (dangerousExtensions.some((ext) => filename.toLowerCase().endsWith(ext))) {
      violations.push({
        type: 'format',
        message: 'File has a potentially dangerous extension.',
        severity: 'error',
      });
    }

    return {
      isValid: violations.filter((v) => v.severity === 'error').length === 0,
      violations,
    };
  }

  detectLanguage(text: string): string {
    // Simple language detection based on character patterns
    // In production, use a proper language detection library
    const patterns: Record<string, RegExp> = {
      en: /\b(the|and|is|are|was|were|have|has|been)\b/gi,
      es: /\b(el|la|los|las|de|que|en|es|un|una)\b/gi,
      fr: /\b(le|la|les|de|et|est|en|que|un|une)\b/gi,
      de: /\b(der|die|das|und|ist|ein|eine|zu|auf)\b/gi,
      pt: /\b(o|a|os|as|de|que|em|um|uma|para)\b/gi,
    };

    const scores: Record<string, number> = {};

    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = text.match(pattern) || [];
      scores[lang] = matches.length;
    }

    const detected = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

    if (detected && detected[1] > 0) {
      return detected[0];
    }

    return 'en'; // Default to English
  }

  sanitizeInput(input: string): string {
    return input
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[<>'"]/g, '') // Remove dangerous characters
      .trim();
  }

  private containsInjectionAttempt(query: string): boolean {
    const injectionPatterns = [
      /;\s*drop\s+table/i,
      /;\s*delete\s+from/i,
      /union\s+select/i,
      /'\s*or\s+'1'\s*=\s*'1/i,
      /--\s*$/,
      /\/\*.*\*\//,
    ];

    return injectionPatterns.some((pattern) => pattern.test(query));
  }

  updateConfig(newConfig: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Policy configuration updated', { config: this.config });
  }

  getConfig(): PolicyConfig {
    return { ...this.config };
  }
}

export const policyService = new PolicyService();
