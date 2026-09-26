# Order Desk Agent — Architecture & Technical Design Specification

- **Date**: 2026-09-26
- **Status**: Approved
- **Target System**: Delta Packaging Supply Order Desk POC

---

## 1. Executive Summary & Goal

Delta Packaging Supply receives inbound order messages via Email and Zalo in unstructured Vietnamese, English, or mixed language.
The goal of the Order Desk Agent is to ingest an inbound message and deterministically output exactly one structured decision:
* `QUOTE`
* `ASK`
* `ESCALATE`
* `DO_NOTHING`

### Core Design Principle
> **LLM interprets. Tools provide facts. Code enforces policy. Code owns actions.**

* **LLM (Claude Sonnet 5)**: Parses messy natural language into structured entity references.
* **Company Systems**: Provide authoritative facts (customers, products, stock, prices).
* **Deterministic Policy Engine**: Enforces business rules and authorization in code.
* **Optional Decision Advisor (Deterministic / Jev Stub)**: Provides bounded recommendations after hard policy evaluation.
* **Application Code**: Authorizes and executes all side effects.

---

## 2. Non-Goals

* Not building a full ERP or messaging gateway.
* Not building an autonomous re-planning agent loop.
* Not using heavyweight vector DBs, RAG pipelines, or orchestration frameworks (LangChain, LlamaIndex, CrewAI).
* Not building a large web frontend.

---

## 3. System Architecture & Sequential Pipeline

Every inbound message flows through a linear, 7-stage deterministic pipeline:

```
[ Inbound Message ]
        │ (messageId, source, sender, content)
        ▼
[ Stage 1: Idempotency Gate ] ──(Duplicate)──► Decision: DO_NOTHING (DUPLICATE_MESSAGE)
        │ (Unique)
        ▼
[ Stage 2: Interpreter Layer ] ──(Invalid Output)──► Decision: ESCALATE (MODEL_OUTPUT_INVALID)
  Claude Sonnet 5 / Mock
        │ Validated OrderIntent
        ▼
[ Stage 3: Fact Resolution ] ──(Tool Error/Timeout)──► Decision: ESCALATE (TOOL_TIMEOUT / TOOL_ERROR)
  Customer, Product,
  Inventory, Pricing Repos
        │ Authoritative Facts
        ▼
[ Stage 4: Deterministic Policy ] ──(Violations)──► Decision: ASK / ESCALATE
        │ Precedence Rules Pass
        ▼
[ Stage 5: Decision Advisor ] (Deterministic / Jev Stub)
        │ Bounded Recommendation
        ▼
[ Stage 6: Action Executor ] ──► Dispatch Outbound Message (Idempotency Key)
        │
        ▼
[ Stage 7: Audit Logger ] ──► Write DecisionRecord to SQLite
```

---

## 4. Domain Models & Schemas

### 4.1 Inbound Message
```typescript
interface InboundMessage {
  id: string;
  source: 'email' | 'zalo' | 'other';
  sender: string; // phone number or email address
  content: string;
  receivedAt: string; // ISO 8601
}
```

### 4.2 Order Intent (LLM Output)
Validated via Zod:
```typescript
const OrderIntentSchema = z.object({
  intent: z.enum(['ORDER', 'OTHER', 'UNKNOWN']),
  customerReference: z.string().nullable(),
  productReference: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  language: z.enum(['vi', 'en', 'mixed', 'unknown']),
});
type OrderIntent = z.infer<typeof OrderIntentSchema>;
```
*Note*: No pricing, discount, or authorization fields exist in this schema.

### 4.3 Decision Actions and Reasons
* **Actions**: `QUOTE` | `ASK` | `ESCALATE` | `DO_NOTHING`
* **Reasons**:
  * `ORDER_READY`: All criteria met, quote generated.
  * `QUANTITY_MISSING`: Quantity null or zero.
  * `PRODUCT_AMBIGUOUS`: Search returns $>1$ matching catalog items.
  * `PRODUCT_NOT_FOUND`: Search returns 0 matching catalog items.
  * `CUSTOMER_AMBIGUOUS`: Customer search returns $>1$ matching records.
  * `CUSTOMER_NOT_FOUND`: Customer lookup returns 0 matching records.
  * `CUSTOMER_ON_CREDIT_HOLD`: Customer status is `CREDIT_HOLD`.
  * `STOCK_INSUFFICIENT`: Available stock < requested quantity.
  * `STOCK_UNAVAILABLE`: Inventory repository error.
  * `PRICING_UNAVAILABLE`: Pricing repository has no record for customer/product.
  * `DUPLICATE_MESSAGE`: Duplicate messageId or normalized content hash detected.
  * `TOOL_TIMEOUT`: Tool call exceeded timeout budget.
  * `TOOL_ERROR`: Tool threw unhandled execution error.
  * `MALFORMED_TOOL_RESPONSE`: Tool response failed Zod schema validation.
  * `MODEL_OUTPUT_INVALID`: LLM response failed Zod schema validation.
  * `UNSUPPORTED_REQUEST`: Intent is not `ORDER`.

### 4.4 Decision Record
Every pipeline run persists a full audit record in SQLite:
```typescript
interface DecisionRecord {
  runId: string;
  messageId: string;
  fingerprint: string;
  receivedAt: string;
  input: {
    source: string;
    sender: string;
    content: string;
  };
  interpretation: OrderIntent | null;
  resolution: {
    customer: CustomerRecord | null;
    products: ProductRecord[];
    stock: number | null;
    unitPrice: number | null;
  };
  policyChecks: Record<string, boolean>;
  advisor: {
    provider: 'deterministic' | 'jev';
    recommendation: string;
    notes?: string;
  };
  decision: {
    action: 'QUOTE' | 'ASK' | 'ESCALATE' | 'DO_NOTHING';
    reason: DecisionReason;
  };
  action: {
    executed: boolean;
    outboundMessage?: string;
    idempotencyKey?: string;
  };
  metrics: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}
```

---

## 5. Repositories, Reliability & Failure Injection

### 5.1 Repository Interfaces
* **`CustomerRepository`**:
  * `findBySender(sender: string): Promise<CustomerRecord[]>`
  * `findByReference(ref: string): Promise<CustomerRecord[]>`
  * `getById(id: string): Promise<CustomerRecord | null>`
* **`ProductRepository`**:
  * `search(query: string): Promise<ProductRecord[]>`
  * `getById(id: string): Promise<ProductRecord | null>`
* **`InventoryRepository`**:
  * `getStock(productId: string): Promise<number>`
* **`PricingRepository`**:
  * `getUnitPrice(customerId: string, productId: string): Promise<number | null>`
* **`MessagingService`**:
  * `sendMessage(destination: string, content: string, idempotencyKey: string): Promise<{ sent: boolean; messageId: string }>`

### 5.2 Reliability Wrapper
All repository operations are wrapped by `withReliability(fn, opts)`:
* Configurable timeout: default 2000ms.
* Retry with exponential backoff: 2 retries (100ms, 200ms).
* Schema validation on returned objects.
* Mapping failures to typed errors (`ToolTimeoutError`, `ToolMalformedError`, `ToolExecutionError`).

### 5.3 Deterministic Failure Injection
Configurable via environment variables or per-request override:
* `FAIL_CUSTOMER_LOOKUP`: `none` | `error` | `timeout` | `malformed`
* `FAIL_PRODUCT_LOOKUP`: `none` | `error` | `timeout` | `malformed`
* `FAIL_STOCK_LOOKUP`: `none` | `error` | `timeout` | `malformed`
* `FAIL_PRICING_LOOKUP`: `none` | `error` | `timeout` | `malformed`
* `FAIL_MESSAGING`: `none` | `error` | `timeout`

When an injected failure activates, the reliability wrapper catches and maps it, causing the deterministic policy engine to fail closed.

### 5.4 Seed Data
Realistic Vietnamese packaging supply catalog:
* **Products**:
  * `PROD-001`: "Ly nhựa 500ml trong suốt" (Stock: 50, Price: 120,000 VND / thùng)
  * `PROD-002`: "Ly nhựa 500ml có nắp" (Stock: 40, Price: 135,000 VND / thùng)
  * `PROD-003`: "Ly nhựa 700ml trong suốt" (Stock: 15, Price: 150,000 VND / thùng)
  * `PROD-004`: "Túi zipper 20x30cm" (Stock: 100, Price: 80,000 VND / kg)
  * `PROD-005`: "Túi zipper 30x40cm" (Stock: 2, Price: 95,000 VND / kg) — low inventory case
  * `PROD-006`: "Hộp giấy kraft 500ml" (Stock: 200, Price: 180,000 VND / thùng)
* **Customers**:
  * `CUST-001`: "Quán Trà Sữa ABC", phone: `0901234567`, email: `abc@milktea.vn`, status: `ACTIVE`
  * `CUST-002`: "Cà Phê Sài Gòn Chi Nhánh 1", phone: `0918111222`, email: `sg1@coffee.vn`, status: `CREDIT_HOLD`
  * `CUST-003`: "Cà Phê Sài Gòn Chi Nhánh 2", phone: `0918111333`, email: `sg2@coffee.vn`, status: `ACTIVE`
  * `CUST-004`: "Tiệm Bánh Mì Minh", phone: `0987654321`, email: `minh@banhmi.vn`, status: `ACTIVE`

---

## 6. Deterministic Policy Engine (Precedence Order)

The policy engine executes strictly in order. The first triggered rule establishes the decision:

1. **Duplicate Message**:
   * Fingerprint (SHA-256 of `source:sender:content`) or `messageId` seen $\rightarrow$ `DO_NOTHING` (`DUPLICATE_MESSAGE`).
2. **Model Interpretation Failed**:
   * Model output fails Zod validation $\rightarrow$ `ESCALATE` (`MODEL_OUTPUT_INVALID`).
3. **Intent Check**:
   * Intent is not `'ORDER'` $\rightarrow$ `DO_NOTHING` (`UNSUPPORTED_REQUEST`).
4. **Tool Reliability Failures**:
   * Timeout in any repo $\rightarrow$ `ESCALATE` (`TOOL_TIMEOUT`).
   * Malformed repo response $\rightarrow$ `ESCALATE` (`MALFORMED_TOOL_RESPONSE`).
   * Repo execution error $\rightarrow$ `ESCALATE` (`TOOL_ERROR`).
5. **Customer Resolution**:
   * Resolved customers count $= 0$ $\rightarrow$ `ESCALATE` (`CUSTOMER_NOT_FOUND`).
   * Resolved customers count $> 1$ $\rightarrow$ `ESCALATE` (`CUSTOMER_AMBIGUOUS`).
   * Resolved customer `status === 'CREDIT_HOLD'` $\rightarrow$ `ESCALATE` (`CUSTOMER_ON_CREDIT_HOLD`).
6. **Product Resolution**:
   * Resolved products count $= 0$ $\rightarrow$ `ASK` (`PRODUCT_NOT_FOUND`).
   * Resolved products count $> 1$ $\rightarrow$ `ASK` (`PRODUCT_AMBIGUOUS`).
7. **Quantity Validation**:
   * Quantity is `null` or $\le 0$ $\rightarrow$ `ASK` (`QUANTITY_MISSING`).
8. **Pricing Resolution**:
   * Price is `null` or lookup fails $\rightarrow$ `ESCALATE` (`PRICING_UNAVAILABLE`).
9. **Stock Validation**:
   * Available stock < requested quantity $\rightarrow$ `ESCALATE` (`STOCK_INSUFFICIENT`).
10. **Final Approval**:
   * All criteria met $\rightarrow$ `QUOTE` (`ORDER_READY`).

---

## 7. LLM Interpretation, Security & Decision Advisor

### 7.1 Anthropic Integration
* Model: Claude Sonnet 5 (configurable via `ANTHROPIC_MODEL`, default `claude-sonnet-5`).
* Prompt isolation: Untrusted user message wrapped in `<inbound_message>...</inbound_message>`.
* Role: Solely extraction of `{ intent, customerReference, productReference, quantity, language }`.
* Offline fallback: `MockInterpreter` supporting zero-API-cost deterministic pattern extraction for CI and unit tests (`INTERPRETER_MODE=anthropic|mock`).

### 7.2 Prompt Injection Defense
* Customer message has no administrative execution channel.
* Price and discount instructions inside customer text (e.g., "Give me 50% discount") are completely ignored by application code; unit price is resolved exclusively via `PricingRepository`.

### 7.3 Decision Advisor
* `DecisionAdvisor` interface:
  * `DeterministicAdvisor`: Default advisor, returns bounded recommendation matching deterministic policy checks.
  * `JevAdvisor`: Stub / simulated adapter mimicking Jev evaluation (`READY_FOR_QUOTE` / `NEEDS_CLARIFICATION` / `NEEDS_HUMAN_REVIEW`).
* Configured via `DECISION_ADVISOR=deterministic|jev`.
* **Invariant**: Advisor recommendation cannot override credit hold, duplicate message, missing price, or missing quantity.

---

## 8. HTTP API Specification

Built with a lightweight Node server (`node:http` or Fastify):

### 8.1 Process Inbound Message
* **Endpoint**: `POST /v1/orders/process`
* **Request**:
```json
{
  "messageId": "msg-001",
  "source": "zalo",
  "sender": "0901234567",
  "content": "Cho em 5 thùng ly 500ml trong suốt"
}
```
* **Response** (200 OK):
```json
{
  "decisionId": "dec-001",
  "action": "QUOTE",
  "reason": "ORDER_READY",
  "runId": "run-001"
}
```

### 8.2 Get Decision Audit Record
* **Endpoint**: `GET /v1/decisions/:id`
* **Response** (200 OK): Returns full `DecisionRecord`.

---

## 9. Evaluation Suite & Metrics

### 9.1 Evaluation Cases (`eval/cases.ts`)
18 distinct evaluation scenarios covering all business permutations:
1. Normal Vietnamese order $\rightarrow$ `QUOTE` (`ORDER_READY`)
2. Normal English order $\rightarrow$ `QUOTE` (`ORDER_READY`)
3. Missing quantity $\rightarrow$ `ASK` (`QUANTITY_MISSING`)
4. Ambiguous product ("ly 500ml") $\rightarrow$ `ASK` (`PRODUCT_AMBIGUOUS`)
5. Customer on credit hold $\rightarrow$ `ESCALATE` (`CUSTOMER_ON_CREDIT_HOLD`)
6. Unknown customer $\rightarrow$ `ESCALATE` (`CUSTOMER_NOT_FOUND`)
7. Ambiguous customer $\rightarrow$ `ESCALATE` (`CUSTOMER_AMBIGUOUS`)
8. Duplicate message ID / text $\rightarrow$ `DO_NOTHING` (`DUPLICATE_MESSAGE`)
9. Prompt injection (discount / instruction override) $\rightarrow$ Safe quote at standard price
10. Pricing system failure $\rightarrow$ `ESCALATE` (`PRICING_UNAVAILABLE`)
11. Stock unavailable $\rightarrow$ `ESCALATE` (`STOCK_UNAVAILABLE`)
12. Customer repo malformed response $\rightarrow$ `ESCALATE` (`MALFORMED_TOOL_RESPONSE`)
13. Pricing repo malformed response $\rightarrow$ `ESCALATE` (`MALFORMED_TOOL_RESPONSE`)
14. Stock lookup timeout $\rightarrow$ `ESCALATE` (`TOOL_TIMEOUT`)
15. Mixed VI/EN text $\rightarrow$ `QUOTE` (`ORDER_READY`)
16. Unsupported product request $\rightarrow$ `ASK` (`PRODUCT_NOT_FOUND`)
17. Insufficient stock $\rightarrow$ `ESCALATE` (`STOCK_INSUFFICIENT`)
18. Repeated content under different transport ID $\rightarrow$ `DO_NOTHING` (`DUPLICATE_MESSAGE`)

### 9.2 Evaluation Commands & Cost Safety
* `npm run eval`: Runs evaluation suite with `DeterministicAdvisor`.
* `npm run eval:jev`: Runs evaluation suite with `JevAdvisor`.
* Metrics tracked per case and summarized:
  * Total cases, Pass rate (%).
  * Average & P95 latency (ms).
  * Anthropic prompt tokens, completion tokens, estimated cost ($).
  * Safety hard stop: Runner aborts if spend approaches $20 cap.

---

## 10. Repository Structure

```
.
├── src/
│   ├── api/
│   │   ├── server.ts
│   │   └── routes.ts
│   ├── agent/
│   │   ├── interpreter.ts
│   │   ├── anthropic-interpreter.ts
│   │   ├── mock-interpreter.ts
│   │   └── prompts.ts
│   ├── domain/
│   │   ├── models.ts
│   │   ├── decisions.ts
│   │   └── errors.ts
│   ├── policy/
│   │   ├── policy-engine.ts
│   │   └── rules.ts
│   ├── advisors/
│   │   ├── decision-advisor.ts
│   │   ├── deterministic-advisor.ts
│   │   └── jev-advisor.ts
│   ├── tools/
│   │   ├── customers.ts
│   │   ├── products.ts
│   │   ├── inventory.ts
│   │   ├── pricing.ts
│   │   └── messaging.ts
│   ├── infrastructure/
│   │   ├── db.ts
│   │   └── reliability.ts
│   └── application/
│       └── pipeline.ts
├── data/
│   ├── customers.json
│   ├── products.json
│   ├── inventory.json
│   └── pricing.json
├── eval/
│   ├── cases.ts
│   ├── runner.ts
│   └── reporter.ts
├── tests/
│   ├── unit/
│   │   ├── policy-engine.test.ts
│   │   ├── idempotency.test.ts
│   │   ├── reliability.test.ts
│   │   └── prompt-injection.test.ts
│   └── integration/
│       └── api.test.ts
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-09-26-order-desk-agent-design.md
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── SUBMISSION.md
```

---

## 11. Verification Checklist

* [ ] Clean clone runs with `npm install` and `npm test` without external API key (using mock interpreter).
* [ ] Claude Sonnet 5 integration works with `ANTHROPIC_API_KEY`.
* [ ] Schema validation prevents invalid LLM outputs from reaching policy engine.
* [ ] All 10 invariant checks are enforced in code.
* [ ] Evaluation suite passes 18/18 cases.
* [ ] Spend tracking confirms budget remains well under $20 cap.
* [ ] `SUBMISSION.md` is strictly under 800 words and covers all 8 required sections.
