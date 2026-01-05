// Guard trigger definitions
// Source of truth: docs/ai/AI_ASSISTANT_RULES.md

/**
 * Questions that imply decision-making, approval,
 * safety judgement, or design change.
 * These MUST be blocked.
 */

export const BLOCKED_KEYWORDS = [
	"should",
	"can we",
	"is it acceptable",
	"is it safe",
	"approve",
	"approval",
	"change",
	"reduce",
	"increase",
	"allow",
	"skip",
	"replace",
];

/**
 * Regex patterns for more complex sentence structures
 * implying authority or risk.
 */

export const BLOCKED_PATTERNS: RegExp[] = [
	/can\s+we\s+/i,
	/should\s+we\s+/i,
	/is\s+it\s+(safe|acceptable)/i,
	/do\s+we\s+need\s+to\s+change/i,
	/can\s+this\s+be\s+(approved|changed)/i,
];
