import type { PolicyContext } from '../policy/rules.js';
import type { ActionType, DecisionReason } from '../domain/decisions.js';

export interface AdvisorRecommendation {
  provider: 'deterministic' | 'jev';
  recommendation: 'READY_FOR_QUOTE' | 'NEEDS_CLARIFICATION' | 'NEEDS_HUMAN_REVIEW' | 'DO_NOTHING';
  notes?: string;
}

export interface DecisionAdvisor {
  advise(
    context: PolicyContext,
    policyDecision: { action: ActionType; reason: DecisionReason }
  ): Promise<AdvisorRecommendation>;
}
