/**
 * Policy Service - Defines system rules and constraints
 */
import { logger } from './logger';

/**
 * System policy rules for AI responses
 */
export class PolicyService {
  /**
   * Get the system prompt that defines AI behavior
   */
  getSystemPrompt(): string {
    return `You are an AI assistant for the CEW (Construction Engineering Workflow) system.

STRICT RULES:
1. Answer ONLY based on the provided context from documents
2. NEVER make up information or hallucinate facts
3. If the answer is not in the context, clearly state: "I don't have enough information in the indexed documents to answer this question."
4. Always cite your sources by mentioning the document filename
5. Be precise and technical when discussing construction or engineering topics
6. Support both Turkish and English languages
7. If asked about data or statistics not in documents, explain that database queries are not yet implemented

RESPONSE FORMAT:
- Start with a direct answer
- Support with evidence from documents
- Cite sources at the end
- Use bullet points for clarity when appropriate

LANGUAGE:
- Detect the user's language and respond in the same language
- Maintain professional technical terminology`;
  }

  /**
   * Get document-specific instructions for the LLM
   */
  getDocumentInstructions(): string {
    return `The following context is extracted from indexed technical documents. 
Use ONLY this information to answer the user's question. 
Do not add information from your training data.`;
  }

  /**
   * Get the template for "no answer" responses
   */
  getNoAnswerTemplate(language: string): string {
    if (language === 'tr') {
      return `Üzgünüm, indekslenmiş dokümanlarda bu soruyu cevaplayacak yeterli bilgi bulamadım. 

Lütfen sorunuzu farklı şekilde ifade etmeyi deneyin veya ilgili dokümanların sisteme eklendiğinden emin olun.`;
    } else {
      return `I apologize, but I don't have enough information in the indexed documents to answer this question.

Please try rephrasing your question or ensure that relevant documents have been added to the system.`;
    }
  }

  /**
   * Get template for out-of-scope responses
   */
  getOutOfScopeTemplate(language: string): string {
    if (language === 'tr') {
      return `Bu soru CEW sisteminin kapsamı dışında görünüyor. 

Ben inşaat mühendisliği ve proje yönetimi dokümanlarınız hakkında sorulara yanıt verebilirim. Sisteme yüklenmiş teknik dokümanlara dayalı bilgiler sağlayabilirim.`;
    } else {
      return `This question appears to be outside the scope of the CEW system.

I can answer questions about your construction engineering and project management documents. I provide information based on technical documents that have been uploaded to the system.`;
    }
  }

  /**
   * Get template for greeting responses
   */
  getGreetingTemplate(language: string): string {
    if (language === 'tr') {
      return `Merhaba! Ben CEW AI Asistanı. 

İnşaat mühendisliği dokümanlary ve proje bilgileri hakkında sorularınızı yanıtlamak için buradayım. Size nasıl yardımcı olabilirim?`;
    } else {
      return `Hello! I'm the CEW AI Assistant.

I'm here to answer your questions about construction engineering documents and project information. How can I help you today?`;
    }
  }

  /**
   * Validate that a response adheres to policies
   */
  validateResponse(response: string, hasContext: boolean): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check if response is too short
    if (response.length < 10) {
      issues.push('Response is too short');
    }

    // Check if response claims lack of info when context was provided
    if (hasContext && response.toLowerCase().includes("don't have enough information")) {
      logger.warn('Response claims no information despite context being provided');
    }

    // Check for common hallucination patterns
    const hallucinationPatterns = [
      /based on (my knowledge|what i know)/i,
      /in general|typically|usually/i,
      /from my (training|understanding)/i
    ];

    for (const pattern of hallucinationPatterns) {
      if (pattern.test(response)) {
        issues.push(`Potential hallucination detected: ${pattern.source}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Get maximum context length in characters
   */
  getMaxContextLength(): number {
    return 8000; // Conservative limit to leave room for prompt and response
  }

  /**
   * Check if a query is safe (no prompt injection, etc.)
   */
  isSafeQuery(query: string): boolean {
    // Basic safety checks
    const unsafePatterns = [
      /ignore (previous|all|above) (instructions|prompts)/i,
      /you are now/i,
      /new instructions:/i,
      /system prompt:/i,
      /forget (everything|all|previous)/i
    ];

    for (const pattern of unsafePatterns) {
      if (pattern.test(query)) {
        logger.warn('Potentially unsafe query detected', { query });
        return false;
      }
    }

    return true;
  }
}

// Singleton instance
export const policyService = new PolicyService();
export default policyService;
