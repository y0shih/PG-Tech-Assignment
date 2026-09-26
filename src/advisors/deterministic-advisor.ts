import type { DecisionAdvisor, AdvisorRecommendation } from './decision-advisor.js';
import type { PolicyContext } from '../policy/rules.js';
import type { ActionType, DecisionReason } from '../domain/decisions.js';

export class DeterministicAdvisor implements DecisionAdvisor {
  async advise(
    _context: PolicyContext,
    policyDecision: { action: ActionType; reason: DecisionReason }
  ): Promise<AdvisorRecommendation> {
    if (policyDecision.action === 'QUOTE') {
      return { provider: 'deterministic', recommendation: 'READY_FOR_QUOTE' };
    }
    if (policyDecision.action === 'ASK') {
      return { provider: 'deterministic', recommendation: 'NEEDS_CLARIFICATION' };
    }
    if (policyDecision.action === 'DO_NOTHING') {
      return { provider: 'deterministic', recommendation: 'DO_NOTHING' };
    }
    return { provider: 'deterministic', recommendation: 'NEEDS_HUMAN_REVIEW' };
  }
}
