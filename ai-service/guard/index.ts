import { BLOCKED_KEYWORDS, BLOCKED_PATTERNS } from "./triggers";

export function guardPreCheck(question: string): {
  allowed: boolean;
  reason?: string;
} {
  const q = question.toLowerCase();

  for (const keyword of BLOCKED_KEYWORDS) {
    if (q.includes(keyword)) {
      return {
        allowed: false,
        reason: "Blocked by keyword rule",
      };
    }
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(question)) {
      return {
        allowed: false,
        reason: "Blocked by pattern rule",
      };
    }
  }

  return { allowed: true };
}
