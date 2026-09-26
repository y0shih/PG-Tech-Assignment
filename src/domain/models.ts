import { z } from 'zod';

export type MessageSource = 'email' | 'zalo' | 'other';
export type SupportedLanguage = 'vi' | 'en' | 'mixed' | 'unknown';

export interface InboundMessage {
  id: string;
  source: MessageSource;
  sender: string;
  content: string;
  receivedAt: string;
}

export const OrderIntentSchema = z.object({
  intent: z.enum(['ORDER', 'OTHER', 'UNKNOWN']),
  customerReference: z.string().nullable(),
  productReference: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  language: z.enum(['vi', 'en', 'mixed', 'unknown']),
});

export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  creditStatus: 'ACTIVE' | 'CREDIT_HOLD';
}

export interface ProductRecord {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stock: number;
  basePrice: number;
}
