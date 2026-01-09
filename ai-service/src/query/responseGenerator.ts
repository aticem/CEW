import { QueryResult, QueryType, SourceReference, ChatMessage } from '../types';
import { llmService } from '../services/llmService';
import { logger } from '../services/logger';
import { RetrievalResult } from './retriever';

export interface GenerationOptions {
  includeSourceCitations?: boolean;
  maxResponseLength?: number;
  temperature?: number;
  conversationHistory?: ChatMessage[];
}

class ResponseGenerator {
  private systemPrompts: Record<QueryType, string> = {
    document: `You are a helpful AI assistant for a Construction Engineering Workflow (CEW) application.
Your role is to answer questions based on the provided document context.

Guidelines:
- Base your answers ONLY on the provided context
- If the context doesn't contain enough information, say so clearly
- Cite specific sources when referencing information
- Use clear, professional language appropriate for construction industry
- Format responses with bullet points or numbered lists when appropriate
- If asked about something not in the context, acknowledge this limitation`,

    data: `You are a helpful AI assistant specializing in extracting and analyzing data from construction documents.

Guidelines:
- Extract precise data values, measurements, and calculations
- Present numerical data clearly with units
- Create tables when comparing multiple values
- Highlight any discrepancies or notable patterns
- If data is incomplete or unclear, note the limitations
- Always cite the source document for data values`,

    hybrid: `You are a helpful AI assistant for a Construction Engineering Workflow (CEW) application.
You handle both document search and data extraction queries.

Guidelines:
- Combine document context with data extraction as needed
- Present information in a clear, organized manner
- Use tables for data comparisons
- Cite sources for both narrative and data content
- Balance completeness with conciseness`,

    conversational: `You are a helpful AI assistant for a Construction Engineering Workflow (CEW) application.
You're here to help users navigate the system and answer general questions.

Guidelines:
- Be friendly and helpful
- Provide guidance on using the document Q&A system
- If the user seems to want document information, guide them to ask specific questions
- Keep responses conversational but professional`,
  };

  async generate(
    query: string,
    queryType: QueryType,
    retrievalResult: RetrievalResult,
    options?: GenerationOptions
  ): Promise<QueryResult> {
    const startTime = Date.now();
    const opts = this.getDefaultOptions(options);

    // Build the prompt
    const prompt = this.buildPrompt(
      query,
      queryType,
      retrievalResult,
      opts.conversationHistory
    );

    // Generate response from LLM
    const response = await llmService.generateResponse({
      prompt,
      systemPrompt: this.systemPrompts[queryType],
      temperature: opts.temperature,
      maxTokens: opts.maxResponseLength,
    });

    // Process and format the response
    let answer = response.content;

    // Add source citations if requested and sources exist
    if (opts.includeSourceCitations && retrievalResult.sources.length > 0) {
      answer = this.addSourceCitations(answer, retrievalResult.sources);
    }

    const processingTime = Date.now() - startTime;

    const result: QueryResult = {
      answer,
      sources: retrievalResult.sources,
      queryType,
      confidence: this.calculateConfidence(retrievalResult),
      processingTimeMs: processingTime,
    };

    logger.info('Response generated', {
      queryType,
      sourcesCount: retrievalResult.sources.length,
      responseLength: answer.length,
      processingTimeMs: processingTime,
    });

    return result;
  }

  async generateConversational(
    query: string,
    conversationHistory?: ChatMessage[]
  ): Promise<QueryResult> {
    const startTime = Date.now();

    const historyContext = conversationHistory
      ? this.formatConversationHistory(conversationHistory)
      : '';

    const prompt = historyContext
      ? `Previous conversation:\n${historyContext}\n\nUser: ${query}`
      : query;

    const response = await llmService.generateResponse({
      prompt,
      systemPrompt: this.systemPrompts.conversational,
      temperature: 0.7,
    });

    const processingTime = Date.now() - startTime;

    return {
      answer: response.content,
      sources: [],
      queryType: 'conversational',
      confidence: 1,
      processingTimeMs: processingTime,
    };
  }

  private buildPrompt(
    query: string,
    queryType: QueryType,
    retrievalResult: RetrievalResult,
    conversationHistory?: ChatMessage[]
  ): string {
    const parts: string[] = [];

    // Add conversation history if present
    if (conversationHistory && conversationHistory.length > 0) {
      parts.push('Previous conversation:');
      parts.push(this.formatConversationHistory(conversationHistory));
      parts.push('');
    }

    // Add context
    if (retrievalResult.context) {
      parts.push('Relevant document context:');
      parts.push('```');
      parts.push(retrievalResult.context);
      parts.push('```');
      parts.push('');
    } else {
      parts.push('Note: No relevant documents were found for this query.');
      parts.push('');
    }

    // Add the query
    parts.push('User question:');
    parts.push(query);

    // Add response guidance based on query type
    if (queryType === 'data') {
      parts.push('');
      parts.push('Please extract and present the relevant data from the context above.');
    }

    return parts.join('\n');
  }

  private formatConversationHistory(messages: ChatMessage[]): string {
    return messages
      .slice(-6) // Keep last 6 messages for context
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');
  }

  private addSourceCitations(
    answer: string,
    sources: SourceReference[]
  ): string {
    if (sources.length === 0) return answer;

    const citations = sources
      .map((source, index) => {
        const pageInfo = source.pageNumber ? `, Page ${source.pageNumber}` : '';
        return `[${index + 1}] ${source.documentName}${pageInfo}`;
      })
      .join('\n');

    return `${answer}\n\n**Sources:**\n${citations}`;
  }

  private calculateConfidence(retrievalResult: RetrievalResult): number {
    if (retrievalResult.chunks.length === 0) {
      return 0.1;
    }

    // Average relevance score of top chunks
    const avgScore =
      retrievalResult.chunks.reduce((sum, c) => sum + c.score, 0) /
      retrievalResult.chunks.length;

    // Scale to 0-1 range (assuming scores are typically 0.7-1.0 for good matches)
    return Math.min(Math.max((avgScore - 0.5) * 2, 0), 1);
  }

  private getDefaultOptions(
    options?: GenerationOptions
  ): Required<GenerationOptions> {
    return {
      includeSourceCitations: options?.includeSourceCitations ?? true,
      maxResponseLength: options?.maxResponseLength ?? 2000,
      temperature: options?.temperature ?? 0.3,
      conversationHistory: options?.conversationHistory ?? [],
    };
  }
}

export const responseGenerator = new ResponseGenerator();
