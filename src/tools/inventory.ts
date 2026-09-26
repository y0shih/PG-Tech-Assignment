import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { withReliability, type FailureInjectionMode } from '../infrastructure/reliability.js';

export interface InventoryRepository {
  getStock(productId: string, injection?: FailureInjectionMode): Promise<number>;
}

export class JsonInventoryRepository implements InventoryRepository {
  private inventory: Record<string, number>;

  constructor(filePath?: string) {
    const defaultPath = path.resolve(process.cwd(), 'data/inventory.json');
    const content = readFileSync(filePath || defaultPath, 'utf8');
    this.inventory = JSON.parse(content);
  }

  async getStock(productId: string, injection?: FailureInjectionMode): Promise<number> {
    return withReliability('stock', async () => {
      return this.inventory[productId] ?? 0;
    }, { injection, schema: z.number() });
  }
}
