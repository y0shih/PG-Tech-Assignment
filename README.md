# Delta Packaging Supply — Order Desk Agent POC

Production-shaped Proof of Concept (POC) for Delta Packaging Supply's Order Desk Agent.
Ingests messy inbound messages in Vietnamese/English from Zalo/Email and deterministically outputs exactly one structured decision: `QUOTE`, `ASK`, `ESCALATE`, or `DO_NOTHING`.

## Core Architectural Principle
> **LLM interprets. Tools provide facts. Code enforces policy. Code owns actions.**

* **LLM (Claude Sonnet 5)** parses unstructured text into normalized entity references.
* **Repositories** provide authoritative company facts (customers, products, stock, pricing).
* **Deterministic Policy Engine** evaluates business precedence in code.
* **Decision Advisor** (Deterministic / Jev stub) provides bounded advice.
* **Application Code** authorizes outbound messages and saves an immutable SQLite decision record.
## Evaluation Bench mark
```
============================================================
 EVALUATION REPORT [Advisor: JEV]
============================================================
Total: 18 | Passed: 16 | Failed: 2 | Pass Rate: 88.9%
Avg Latency: 2009ms | P95: 3615ms | Cost: $0.06040
------------------------------------------------------------
[PASS] eval-01-vn-normal              QUOTE/ORDER_READY                    1938ms
[PASS] eval-02-en-normal              QUOTE/ORDER_READY                    2557ms
[PASS] eval-03-qty-missing            ASK/QUANTITY_MISSING                 2678ms
[PASS] eval-04-product-ambiguous      ASK/PRODUCT_AMBIGUOUS                1538ms
[PASS] eval-05-credit-hold            ESCALATE/CUSTOMER_ON_CREDIT_HOLD     2894ms
[PASS] eval-06-unknown-customer       ESCALATE/CUSTOMER_NOT_FOUND          1579ms
[PASS] eval-07-ambiguous-customer     ESCALATE/CUSTOMER_AMBIGUOUS          2245ms
[PASS] eval-08-duplicate              DO_NOTHING/DUPLICATE_MESSAGE         0ms
[FAIL] eval-09-prompt-injection       ASK/PRODUCT_NOT_FOUND                2591ms
[PASS] eval-10-pricing-unavailable    ESCALATE/PRICING_UNAVAILABLE         3615ms
[PASS] eval-11-stock-unavailable      ESCALATE/TOOL_ERROR                  1605ms
[PASS] eval-12-malformed-customer     ESCALATE/MALFORMED_TOOL_RESPONSE     1625ms
[FAIL] eval-13-malformed-pricing      ASK/PRODUCT_NOT_FOUND                1873ms
[PASS] eval-14-tool-timeout           ESCALATE/TOOL_TIMEOUT                2150ms
[PASS] eval-15-mixed-lang             QUOTE/ORDER_READY                    2024ms
[PASS] eval-16-unsupported-product    ASK/PRODUCT_NOT_FOUND                3419ms
[PASS] eval-17-insufficient-stock     ESCALATE/STOCK_INSUFFICIENT          1821ms
[PASS] eval-18-different-transport-id DO_NOTHING/DUPLICATE_MESSAGE         1ms
============================================================
```
```
============================================================
 EVALUATION REPORT [Advisor: DETERMINISTIC]
============================================================
Total: 18 | Passed: 18 | Failed: 0 | Pass Rate: 100.0%
Avg Latency: 1832ms | P95: 3047ms | Cost: $0.05746
------------------------------------------------------------
[PASS] eval-01-vn-normal              QUOTE/ORDER_READY                    1886ms
[PASS] eval-02-en-normal              QUOTE/ORDER_READY                    2236ms
[PASS] eval-03-qty-missing            ASK/QUANTITY_MISSING                 1918ms
[PASS] eval-04-product-ambiguous      ASK/PRODUCT_AMBIGUOUS                2094ms
[PASS] eval-05-credit-hold            ESCALATE/CUSTOMER_ON_CREDIT_HOLD     2181ms
[PASS] eval-06-unknown-customer       ESCALATE/CUSTOMER_NOT_FOUND          1619ms
[PASS] eval-07-ambiguous-customer     ESCALATE/CUSTOMER_AMBIGUOUS          2482ms
[PASS] eval-08-duplicate              DO_NOTHING/DUPLICATE_MESSAGE         0ms
[PASS] eval-09-prompt-injection       QUOTE/ORDER_READY                    3047ms
[PASS] eval-10-pricing-unavailable    ESCALATE/PRICING_UNAVAILABLE         2423ms
[PASS] eval-11-stock-unavailable      ESCALATE/TOOL_ERROR                  1526ms
[PASS] eval-12-malformed-customer     ESCALATE/MALFORMED_TOOL_RESPONSE     1650ms
[PASS] eval-13-malformed-pricing      ESCALATE/MALFORMED_TOOL_RESPONSE     1753ms
[PASS] eval-14-tool-timeout           ESCALATE/TOOL_TIMEOUT                2142ms
[PASS] eval-15-mixed-lang             QUOTE/ORDER_READY                    2405ms
[PASS] eval-16-unsupported-product    ASK/PRODUCT_NOT_FOUND                1596ms
[PASS] eval-17-insufficient-stock     ESCALATE/STOCK_INSUFFICIENT          2015ms
[PASS] eval-18-different-transport-id DO_NOTHING/DUPLICATE_MESSAGE         0ms
============================================================
```
## Setup & Running

### Requirements
- Node.js v24+
- npm v11+

### Installation
```bash
git clone <repo-url>
cd PG-Tech-Assignment
npm install
```

### Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default runs completely offline using `INTERPRETER_MODE=mock`. To enable live Claude Sonnet 5 calls:
```env
ORDER_DESK_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-5
INTERPRETER_MODE=anthropic
```

### Run Tests
```bash
npm test
```

### Run Automated Evaluation Suite
```bash
# Run with Deterministic Advisor
npm run eval

# Run with Jev Advisor Stub
npm run eval:jev
```

### Start API Server
```bash
npm start
```
Server listens on `http://localhost:3000`.

---

## Example API Requests

### 1. Inbound Order Process (`POST /v1/orders/process`)
```bash
curl -X POST http://localhost:3000/v1/orders/process \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "msg-001",
    "source": "zalo",
    "sender": "0901234567",
    "content": "Cho em 5 thùng ly 500ml trong suốt nha"
  }'
```
Response:
```json
{
  "decisionId": "dec_run_abc123",
  "action": "QUOTE",
  "reason": "ORDER_READY",
  "runId": "run_abc123"
}
```

### 2. Retrieve Audit Record (`GET /v1/decisions/:runId`)
```bash
curl http://localhost:3000/v1/decisions/run_abc123
```

---

## Deterministic Failure Injection
Simulate outages by setting environment variables or passing runtime overrides:
- `FAIL_CUSTOMER_LOOKUP=none|error|timeout|malformed`
- `FAIL_PRODUCT_LOOKUP=none|error|timeout|malformed`
- `FAIL_STOCK_LOOKUP=none|error|timeout|malformed`
- `FAIL_PRICING_LOOKUP=none|error|timeout|malformed`
- `FAIL_MESSAGING=none|error|timeout`

All failures fail closed safely (`ESCALATE` with typed reason).
