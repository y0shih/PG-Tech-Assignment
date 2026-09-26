import { describe, it, expect } from 'vitest';
import { JsonCustomerRepository } from '../../src/tools/customers.js';
import { JsonProductRepository } from '../../src/tools/products.js';
import { JsonInventoryRepository } from '../../src/tools/inventory.js';
import { JsonPricingRepository } from '../../src/tools/pricing.js';
import { MockMessagingService } from '../../src/tools/messaging.js';
import { ToolTimeoutError, ToolError } from '../../src/domain/errors.js';

describe('Tool Repositories', () => {
  const customerRepo = new JsonCustomerRepository();
  const productRepo = new JsonProductRepository();
  const inventoryRepo = new JsonInventoryRepository();
  const pricingRepo = new JsonPricingRepository();
  const messagingService = new MockMessagingService();

  it('should resolve customer by sender phone or email', async () => {
    const byPhone = await customerRepo.findBySender('0901234567');
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0]?.name).toBe('Quán Trà Sữa ABC');

    const byEmail = await customerRepo.findBySender('minh@banhmi.vn');
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]?.name).toBe('Tiệm Bánh Mì Minh');
  });

  it('should resolve customer by reference name substring', async () => {
    const matches = await customerRepo.findByReference('Trà Sữa');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('CUST-001');
  });

  it('should get customer by id or return null', async () => {
    const customer = await customerRepo.getById('CUST-001');
    expect(customer?.name).toBe('Quán Trà Sữa ABC');

    const notFound = await customerRepo.getById('CUST-NONEXISTENT');
    expect(notFound).toBeNull();
  });

  it('should find ambiguous products for generic search', async () => {
    const matches = await productRepo.search('ly 500ml');
    expect(matches.length).toBeGreaterThan(1);
  });

  it('should return empty array when query contains only single-letter tokens', async () => {
    const matches = await productRepo.search('a b c');
    expect(matches).toEqual([]);
  });

  it('should resolve single product for specific search', async () => {
    const matches = await productRepo.search('ly nhựa 500ml trong suốt');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('PROD-001');
  });

  it('should get product by id or return null', async () => {
    const product = await productRepo.getById('PROD-001');
    expect(product?.name).toBe('Ly nhựa 500ml trong suốt');

    const notFound = await productRepo.getById('PROD-NONEXISTENT');
    expect(notFound).toBeNull();
  });

  it('should return available inventory', async () => {
    const stock = await inventoryRepo.getStock('PROD-001');
    expect(stock).toBe(50);
  });

  it('should return authoritative customer pricing and null for unknown', async () => {
    const price = await pricingRepo.getUnitPrice('CUST-001', 'PROD-001');
    expect(price).toBe(120000);

    const missingPrice = await pricingRepo.getUnitPrice('CUST-002', 'PROD-004');
    expect(missingPrice).toBeNull();
  });

  it('should dispatch messages idempotently', async () => {
    const res1 = await messagingService.sendMessage('0901234567', 'Chào bạn', 'msg-key-1');
    expect(res1.sent).toBe(true);
    expect(res1.messageId).toMatch(/^msg_out_/);

    const res2 = await messagingService.sendMessage('0901234567', 'Chào bạn', 'msg-key-1');
    expect(res2.sent).toBe(false);
    expect(res2.messageId).toBe(res1.messageId);

    expect(messagingService.getDispatchedCount()).toBe(1);
  });

  it('should respect failure injection in repositories', async () => {
    await expect(customerRepo.findBySender('0901234567', 'timeout'))
      .rejects.toBeInstanceOf(ToolTimeoutError);

    await expect(productRepo.search('ly', 'error'))
      .rejects.toBeInstanceOf(ToolError);

    await expect(inventoryRepo.getStock('PROD-001', 'timeout'))
      .rejects.toBeInstanceOf(ToolTimeoutError);

    await expect(pricingRepo.getUnitPrice('CUST-001', 'PROD-001', 'error'))
      .rejects.toBeInstanceOf(ToolError);

    await expect(messagingService.sendMessage('0901234567', 'test', 'msg-err', 'timeout'))
      .rejects.toBeInstanceOf(ToolTimeoutError);
  });
});
