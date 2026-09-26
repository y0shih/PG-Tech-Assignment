import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { withReliability, type FailureInjectionMode } from '../infrastructure/reliability.js';

export interface PricingRepository {
  getUnitPrice(customerId: string, productId: string, injection?: FailureInjectionMode): Promise<number | null>;
}

export class JsonPricingRepository implements PricingRepository {
  private pricing: Record<string, Record<string, number>>;

  constructor(filePath?: string) {
    const defaultPath = path.resolve(process.cwd(), 'data/pricing.json');
    const content = readFileSync(filePath || defaultPath, 'utf8');
    this.pricing = JSON.parse(content);
  }

  async getUnitPrice(customerId: string, productId: string, injection?: FailureInjectionMode): Promise<number | null> {
    return withReliability('pricing', async () => {
      const customerPrices = this.pricing[customerId];
      if (!customerPrices) return null;
      return customerPrices[productId] ?? null;
    }, { injection, schema: z.number().nullable() });
  }
}
