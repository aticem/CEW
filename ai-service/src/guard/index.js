/**
 * Guard module exports
 */
export {
  runGuardChecks,
  checkNoSpeculation,
  checkNoComplianceClaims,
  checkSourcePresence,
  checkOCRFlags,
  checkConflictingSources,
  getSafeFallback,
  default as guardRules,
} from "./guardRules.js";
