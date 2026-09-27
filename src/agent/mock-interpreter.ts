import type { OrderIntent } from '../domain/models.js';
import { OrderIntentSchema } from '../domain/models.js';
import type { OrderInterpreter, InterpretationResult } from './interpreter.js';

export class MockInterpreter implements OrderInterpreter {
  async interpret(content: string): Promise<OrderIntent> {
    const res = await this.interpretWithMetrics(content);
    return res.intent;
  }

  async interpretWithMetrics(content: string): Promise<InterpretationResult> {
    const start = Date.now();
    const clean = content.toLowerCase();

    // Language detection
    const isVi = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(clean) ||
      clean.includes('cho') || clean.includes('lấy') || clean.includes('thùng') || clean.includes('em');
    const isEn = clean.includes('order') || clean.includes('please') || clean.includes('send') || clean.includes('quote');
    const lang = isVi && isEn ? 'mixed' : isVi ? 'vi' : isEn ? 'en' : 'unknown';

    // Intent check
    let intent: 'ORDER' | 'OTHER' | 'UNKNOWN' = 'ORDER';
    if (clean.includes('chào') && !clean.includes('ly') && !clean.includes('túi') && !clean.includes('hộp')) {
      intent = 'OTHER';
    }

    // Quantity extraction
    let quantity: number | null = null;
    const unitMatch = clean.match(/(\d+)\s*(thùng|kg|cartons|bags|pcs|hộp|hop|cái)\b/);
    if (unitMatch && unitMatch[1]) {
      quantity = parseInt(unitMatch[1], 10);
    } else {
      const qtyMatch = clean.match(/(\d+)\s*(thùng|kg|cartons|bags|pcs|hop|cái)?/);
      if (qtyMatch && qtyMatch[1]) {
        const q = parseInt(qtyMatch[1], 10);
        if (q > 0 && !clean.includes('500ml') && !clean.includes('700ml') && !clean.includes('20x30') && !clean.includes('30x40')) {
          quantity = q;
        } else {
          const separateQty = clean.match(/(?:lấy|send|cho em|order|cần|mua)\s*(\d+)/);
          if (separateQty && separateQty[1]) {
            quantity = parseInt(separateQty[1], 10);
          } else if (qtyMatch && q !== 500 && q !== 700) {
            quantity = q;
          }
        }
      }
    }

    // Product reference extraction
    let productRef: string | null = null;
    if (
      clean.includes('ly 500ml trong suốt') ||
      clean.includes('ly nhựa 500ml trong suốt') ||
      clean.includes('ly 500ml trong suot') ||
      clean.includes('ly nhua 500ml trong suot')
    ) {
      productRef = 'ly 500ml trong suốt';
    } else if (
      clean.includes('ly 500ml có nắp') ||
      clean.includes('ly có nắp') ||
      clean.includes('ly 500ml co nap') ||
      clean.includes('ly co nap')
    ) {
      productRef = 'ly 500ml có nắp';
    } else if (clean.includes('ly 500ml') || clean.includes('ly nhựa 500ml')) {
      productRef = 'ly 500ml';
    } else if (clean.includes('ly 700ml')) {
      productRef = 'ly nhựa 700ml trong suốt';
    } else if (clean.includes('túi zipper 20x30') || clean.includes('zipper 20x30')) {
      productRef = 'túi zipper 20x30cm';
    } else if (clean.includes('túi zipper 30x40') || clean.includes('zipper 30x40')) {
      productRef = 'túi zipper 30x40cm';
    } else if (clean.includes('hộp giấy kraft') || clean.includes('kraft paper box')) {
      productRef = 'hộp giấy kraft 500ml';
    } else if (clean.includes('băng keo') || clean.includes('unsupported')) {
      productRef = 'băng keo đục';
    }

    // Customer reference extraction
    let customerRef: string | null = null;
    if (clean.includes('trà sữa abc') || clean.includes('abc milk tea')) {
      customerRef = 'Quán Trà Sữa ABC';
    } else if (clean.includes('cà phê sài gòn 1')) {
      customerRef = 'Cà Phê Sài Gòn Chi Nhánh 1';
    } else if (clean.includes('cà phê sài gòn')) {
      customerRef = 'Cà Phê Sài Gòn';
    } else if (clean.includes('bánh mì minh')) {
      customerRef = 'Tiệm Bánh Mì Minh';
    }

    const parsed = OrderIntentSchema.parse({
      intent,
      customerReference: customerRef,
      productReference: productRef,
      quantity,
      language: lang,
    });

    return {
      intent: parsed,
      rawOutput: JSON.stringify(parsed),
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - start,
      }
    };
  }
}
