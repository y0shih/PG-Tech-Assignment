import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ProductRecord } from '../domain/models.js';
import { withReliability, type FailureInjectionMode } from '../infrastructure/reliability.js';

const ProductRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  unit: z.string(),
  stock: z.number(),
  basePrice: z.number(),
});

export interface ProductRepository {
  search(query: string, injection?: FailureInjectionMode): Promise<ProductRecord[]>;
  getById(id: string, injection?: FailureInjectionMode): Promise<ProductRecord | null>;
}

export class JsonProductRepository implements ProductRepository {
  private products: ProductRecord[];

  constructor(filePath?: string) {
    const defaultPath = path.resolve(process.cwd(), 'data/products.json');
    const content = readFileSync(filePath || defaultPath, 'utf8');
    this.products = z.array(ProductRecordSchema).parse(JSON.parse(content));
  }

  async search(query: string, injection?: FailureInjectionMode): Promise<ProductRecord[]> {
    return withReliability('product', async () => {
      const clean = query.trim().toLowerCase();
      if (!clean) return [];

      const exact = this.products.filter(p => p.name.toLowerCase() === clean || p.sku.toLowerCase() === clean);
      if (exact.length > 0) return exact;

      // Token search
      const tokens = clean.split(/\s+/).filter(t => t.length > 1);
      return this.products.filter(p => {
        const nameLower = p.name.toLowerCase();
        return tokens.every(token => nameLower.includes(token));
      });
    }, { injection, schema: z.array(ProductRecordSchema) });
  }

  async getById(id: string, injection?: FailureInjectionMode): Promise<ProductRecord | null> {
    return withReliability('product', async () => {
      return this.products.find(p => p.id === id) || null;
    }, { injection });
  }
}
