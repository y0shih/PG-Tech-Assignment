import crypto from 'node:crypto';
import { withReliability, type FailureInjectionMode } from '../infrastructure/reliability.js';

export interface MessageDispatchResult {
  sent: boolean;
  messageId: string;
  idempotencyKey: string;
}

export interface MessagingService {
  sendMessage(
    destination: string,
    content: string,
    idempotencyKey: string,
    injection?: FailureInjectionMode
  ): Promise<MessageDispatchResult>;
}

export class MockMessagingService implements MessagingService {
  private sentMessages = new Map<string, { destination: string; content: string; messageId: string }>();

  async sendMessage(
    destination: string,
    content: string,
    idempotencyKey: string,
    injection?: FailureInjectionMode
  ): Promise<MessageDispatchResult> {
    return withReliability('messaging', async () => {
      if (this.sentMessages.has(idempotencyKey)) {
        return {
          sent: false,
          messageId: this.sentMessages.get(idempotencyKey)!.messageId,
          idempotencyKey,
        };
      }

      const messageId = `msg_out_${crypto.randomBytes(6).toString('hex')}`;
      this.sentMessages.set(idempotencyKey, { destination, content, messageId });
      return { sent: true, messageId, idempotencyKey };
    }, { injection });
  }

  getDispatchedCount(): number {
    return this.sentMessages.size;
  }
}
