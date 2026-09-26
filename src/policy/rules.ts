import type { CustomerRecord, ProductRecord } from '../domain/models.js';
import type { ActionType, DecisionReason } from '../domain/decisions.js';

export interface PolicyContext {
  isDuplicate: boolean;
  interpretationValid: boolean;
  intent: 'ORDER' | 'OTHER' | 'UNKNOWN';
  toolFailureReason: DecisionReason | null;
  customerResolution: {
    records: CustomerRecord[];
    ambiguous: boolean;
  };
  productResolution: {
    records: ProductRecord[];
    ambiguous: boolean;
  };
  quantity: number | null;
  price: number | null;
  stock: number | null;
}

export interface PolicyEvaluationResult {
  action: ActionType;
  reason: DecisionReason;
  policyChecks: Record<string, boolean>;
}
