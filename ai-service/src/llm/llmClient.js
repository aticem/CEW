/**
 * LLM Client - Abstraction layer for LLM API calls
 * MVP: Placeholder for OpenAI/Anthropic/local LLM integration
 */

import { SYSTEM_PROMPT, buildQueryPrompt, formatAnswer } from "./promptTemplates.js";
import { runGuardChecks, getSafeFallback } from "../guard/guardRules.js";

/**
 * LLM Client configuration
 */
const config = {
  // MVP: These will be set via environment variables
  provider: process.env.LLM_PROVIDER || "mock", // 'openai', 'anthropic', 'mock'
  apiKey: process.env.LLM_API_KEY || "",
  model: process.env.LLM_MODEL || "gpt-4",
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "1024", 10),
  temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.1"),
};

/**
 * Mock LLM response generator for testing
 * @param {string} prompt
 * @param {Array} chunks
 * @returns {string}
 */
function mockLLMResponse(prompt, chunks = []) {
  if (chunks.length === 0) {
    return "Bu bilgi yüklenen dokümanlarda bulunamadı.\n\nSource: Not available";
  }

  // Generate a mock response based on the first chunk
  const firstChunk = chunks[0];
  let response = `Answer: Based on the documentation:\n\n"${firstChunk.text.slice(0, 200)}..."`;

  response += `\n\nSource: ${firstChunk.docName}`;
  if (firstChunk.page) response += `, Page ${firstChunk.page}`;
  if (firstChunk.sheetName) response += `, Sheet: ${firstChunk.sheetName}`;

  return response;
}

/**
 * Call OpenAI API
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callOpenAI(systemPrompt, userPrompt) {
  // MVP placeholder - implement when API key is available
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`OpenAI API Error: ${data.error.message}`);
  }

  return data.choices[0].message.content;
}

/**
 * Call Anthropic API
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callAnthropic(systemPrompt, userPrompt) {
  // MVP placeholder - implement when API key is available
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Anthropic API Error: ${data.error.message}`);
  }

  return data.content[0].text;
}

/**
 * Generate an answer using the LLM
 * @param {Object} params
 * @param {string} params.question - User's question
 * @param {Array} params.chunks - Relevant document chunks
 * @param {string} params.routeType - Query route type
 * @returns {Promise<Object>}
 */
export async function generateAnswer({ question, chunks = [], routeType = "DOC" }) {
  const prompt = buildQueryPrompt({ question, chunks, routeType });
  let rawAnswer;

  try {
    switch (config.provider) {
      case "openai":
        rawAnswer = await callOpenAI(SYSTEM_PROMPT, prompt);
        break;
      case "anthropic":
        rawAnswer = await callAnthropic(SYSTEM_PROMPT, prompt);
        break;
      case "mock":
      default:
        rawAnswer = mockLLMResponse(prompt, chunks);
    }
  } catch (error) {
    console.error("LLM call failed:", error);
    return {
      answer: getSafeFallback("not_found"),
      sources: [],
      guardResult: { passed: true, flags: ["LLM_ERROR"] },
      error: error.message,
    };
  }

  // Run guard checks on the response
  const guardResult = runGuardChecks({
    answer: rawAnswer,
    sources: chunks,
    question,
  });

  // If guard fails, return safe fallback
  if (!guardResult.passed) {
    const failReason = guardResult.flags.includes("COMPLIANCE_CLAIM_DETECTED")
      ? "compliance_refused"
      : guardResult.flags.includes("SPECULATION_DETECTED")
      ? "speculation_blocked"
      : "not_found";

    return {
      answer: getSafeFallback(failReason),
      sources: chunks,
      guardResult,
      blocked: true,
    };
  }

  // Format the final answer
  const finalAnswer = formatAnswer({
    answer: rawAnswer,
    sources: chunks,
    guardResult,
  });

  return {
    answer: finalAnswer,
    sources: chunks,
    guardResult,
    blocked: false,
  };
}

/**
 * Get current LLM configuration (without API key)
 * @returns {Object}
 */
export function getConfig() {
  return {
    provider: config.provider,
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  };
}

/**
 * Update LLM configuration
 * @param {Object} newConfig
 */
export function updateConfig(newConfig) {
  if (newConfig.provider) config.provider = newConfig.provider;
  if (newConfig.apiKey) config.apiKey = newConfig.apiKey;
  if (newConfig.model) config.model = newConfig.model;
  if (newConfig.maxTokens) config.maxTokens = newConfig.maxTokens;
  if (newConfig.temperature !== undefined)
    config.temperature = newConfig.temperature;
}

export default {
  generateAnswer,
  getConfig,
  updateConfig,
};
