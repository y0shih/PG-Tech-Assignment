import type { CustomerRecord, ProductRecord } from '../domain/models.js';
import type { ActionType, DecisionReason } from '../domain/decisions.js';
import type { MessagingService } from '../tools/messaging.js';
import type { FailureInjectionMode } from '../infrastructure/reliability.js';

export interface ActionPayload {
  action: ActionType;
  reason: DecisionReason;
  customer: CustomerRecord | null;
  product: ProductRecord | null;
  quantity: number | null;
  unitPrice: number | null;
  language: string;
}

export function formatOutboundMessage(payload: ActionPayload): string | null {
  const isEn = payload.language === 'en';

  if (payload.action === 'QUOTE' && payload.product && payload.unitPrice && payload.quantity) {
    const formattedPrice = new Intl.NumberFormat('vi-VN').format(payload.unitPrice);
    const total = new Intl.NumberFormat('vi-VN').format(payload.unitPrice * payload.quantity);
    if (isEn) {
      return `Delta Packaging Quote: ${payload.quantity} ${payload.product.unit} of "${payload.product.name}" at ${formattedPrice} VND/unit. Total: ${total} VND. Reply to confirm order.`;
    }
    return `Delta Packaging kính gửi báo giá: ${payload.quantity} ${payload.product.unit} "${payload.product.name}", đơn giá ${formattedPrice} đ/${payload.product.unit}. Tổng tiền: ${total} đ. Dạ anh/chị xác nhận để bên em lên đơn ạ.`;
  }

  if (payload.action === 'ASK') {
    if (payload.reason === 'QUANTITY_MISSING') {
      return isEn
        ? 'Thank you for reaching out to Delta Packaging. Please let us know the quantity you would like to order.'
        : 'Dạ Delta Packaging xin chào anh/chị. Anh/chị cho em xin số lượng cần đặt giúp em với ạ.';
    }
    if (payload.reason === 'PRODUCT_AMBIGUOUS') {
      return isEn
        ? 'We found multiple products matching your request. Could you please specify the exact product or SKU?'
        : 'Dạ bên em tìm thấy nhiều sản phẩm phù hợp với yêu cầu. Anh/chị cho em xin tên loại sản phẩm cụ thể hơn giúp em ạ.';
    }
    if (payload.reason === 'PRODUCT_NOT_FOUND') {
      return isEn
        ? 'We could not find the requested product in our catalog. Could you please provide more details or an image?'
        : 'Dạ sản phẩm anh/chị tìm hiện chưa có trong danh mục. Anh/chị cho em xin thêm thông tin mô tả chi tiết giúp em ạ.';
    }
  }

  // ESCALATE and DO_NOTHING send no outbound message to customer
  return null;
}

export async function executeAction(
  messagingService: MessagingService,
  destination: string,
  payload: ActionPayload,
  idempotencyKey: string,
  injection?: FailureInjectionMode
): Promise<{ executed: boolean; outboundMessage?: string; idempotencyKey?: string }> {
  const content = formatOutboundMessage(payload);
  if (!content) {
    return { executed: false };
  }

  try {
    const result = await messagingService.sendMessage(destination, content, idempotencyKey, injection);
    return {
      executed: result.sent,
      outboundMessage: content,
      idempotencyKey,
    };
  } catch {
    return {
      executed: false,
      outboundMessage: content,
      idempotencyKey,
    };
  }
}
