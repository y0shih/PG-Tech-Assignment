import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { CustomerRecord } from '../domain/models.js';
import { withReliability, type FailureInjectionMode } from '../infrastructure/reliability.js';

const CustomerRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  creditStatus: z.enum(['ACTIVE', 'CREDIT_HOLD']),
});

export interface CustomerRepository {
  findBySender(sender: string, injection?: FailureInjectionMode): Promise<CustomerRecord[]>;
  findByReference(reference: string, injection?: FailureInjectionMode): Promise<CustomerRecord[]>;
  getById(id: string, injection?: FailureInjectionMode): Promise<CustomerRecord | null>;
}

export class JsonCustomerRepository implements CustomerRepository {
  private customers: CustomerRecord[];

  constructor(filePath?: string) {
    const defaultPath = path.resolve(process.cwd(), 'data/customers.json');
    const content = readFileSync(filePath || defaultPath, 'utf8');
    this.customers = z.array(CustomerRecordSchema).parse(JSON.parse(content));
  }

  async findBySender(sender: string, injection?: FailureInjectionMode): Promise<CustomerRecord[]> {
    return withReliability('customer', async () => {
      const clean = sender.trim().toLowerCase();
      return this.customers.filter(c => c.phone.toLowerCase() === clean || c.email.toLowerCase() === clean);
    }, { injection, schema: z.array(CustomerRecordSchema) });
  }

  async findByReference(reference: string, injection?: FailureInjectionMode): Promise<CustomerRecord[]> {
    return withReliability('customer', async () => {
      const clean = reference.trim().toLowerCase();
      return this.customers.filter(c => c.name.toLowerCase().includes(clean));
    }, { injection, schema: z.array(CustomerRecordSchema) });
  }

  async getById(id: string, injection?: FailureInjectionMode): Promise<CustomerRecord | null> {
    return withReliability('customer', async () => {
      return this.customers.find(c => c.id === id) || null;
    }, { injection });
  }
}
