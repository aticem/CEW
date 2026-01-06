import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

export const anthropic = new Anthropic({ apiKey });

export async function askClaude(params: {
  system: string;
  user: string;
  maxTokens?: number;
}) {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

  const res = await anthropic.messages.create({
    model,
    max_tokens: params.maxTokens ?? 800,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  });

  // Claude content is array; we only support text output
  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  return { text, model: res.model };
}
