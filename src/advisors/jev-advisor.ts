import type { DecisionAdvisor, AdvisorRecommendation } from './decision-advisor.js';
import type { PolicyContext } from '../policy/rules.js';
import type { ActionType, DecisionReason } from '../domain/decisions.js';
import { DeterministicAdvisor } from './deterministic-advisor.js';

export class JevAdvisor implements DecisionAdvisor {
  async advise(
    _context: PolicyContext,
    policyDecision: { action: ActionType; reason: DecisionReason }
  ): Promise<AdvisorRecommendation> {
    // Jev bounded advisor stub: Provides bounded advice without ever overriding hard business policy
    let rec: AdvisorRecommendation['recommendation'] = 'NEEDS_HUMAN_REVIEW';
    if (policyDecision.action === 'QUOTE') rec = 'READY_FOR_QUOTE';
    else if (policyDecision.action === 'ASK') rec = 'NEEDS_CLARIFICATION';
    else if (policyDecision.action === 'DO_NOTHING') rec = 'DO_NOTHING';

    return {
      provider: 'jev',
      recommendation: rec,
      notes: 'Jev simulated bounded advisory confirmation.',
    };
  }
}

export function createAdvisor(): DecisionAdvisor {
  const advisorType = (process.env.DECISION_ADVISOR || 'deterministic').toLowerCase();
  if (advisorType === 'jev') {
    return new JevAdvisor();
  }
  return new DeterministicAdvisor();
}
