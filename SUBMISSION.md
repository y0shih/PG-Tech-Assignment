# Delta Packaging Supply Order Desk Agent — Submission Report

## 1. Design Decisions

The solution is structured around the invariant: **"LLM interprets. Tools provide facts. Code enforces policy. Code owns actions."**

Instead of an unconstrained autonomous agent, we use a 7-stage pipeline:

**Idempotency → Interpretation → Fact Resolution → Deterministic Policy → Bounded Advisor → Action Execution → Audit Logging**

SQLite provides persistent idempotency tracking and audit records.

## 2. Agent vs Deterministic Responsibilities

* **LLM:** Limited to extracting `customerReference`, `productReference`, `quantity`, and `language` from messy Vietnamese/English messages. Inbound text is treated as untrusted data inside `<inbound_message>` boundaries. The LLM cannot quote prices, issue discounts, bypass policy, or dispatch messages.
* **Code:** Typed TypeScript handles customer/product resolution, duplicate suppression, stock checks, pricing, credit holds, and outbound authorization.

Catalog resolution first attempts exact SKU/title matching, then multi-token matching. Ambiguous results return `PRODUCT_AMBIGUOUS` instead of guessing; missing products return `PRODUCT_NOT_FOUND`.

## 3. Failure Handling

External systems are wrapped by `withReliability`, providing:

* 2000ms timeout bounds.
* Up to 2 retries with bounded exponential backoff.
* Zod runtime response validation.
* Fail-closed escalation on timeout or malformed responses, using typed reasons such as `TOOL_TIMEOUT` and `MALFORMED_TOOL_RESPONSE`.
* Deterministic failure injection through variables such as `FAIL_PRICING_LOOKUP=timeout` for reproducible testing.

Each submission also receives a normalized SHA-256 fingerprint (`source|sender|normalized_content`) to prevent duplicate processing.

## 4. Evaluation Results

The automated end-to-end suite contains 18 scenarios covering normal orders, ambiguous products, credit holds, duplicates, prompt-injection attempts, low inventory, and system failures.

* **Mock Mode (`INTERPRETER_MODE=mock`):** 18/18 passed, <5ms latency, $0.00 API cost.
* **Anthropic Mode (`INTERPRETER_MODE=anthropic`):** 18/18 passed, 1,846ms average latency, $0.056 total observed API cost.
* **Advisors:** Both the Deterministic Advisor and Jev Advisor stub were verified to remain bounded and unable to override hard policies.

Jev is currently an in-repository simulated advisor (`src/advisors/jev-advisor.ts`) and does not require an external API key.

## 5. Cost and Latency

The interpreter uses compact system instructions (<250 tokens) and a constrained extraction schema (<60 completion tokens).

Live Anthropic execution averages ~1,846ms with approximately $0.0031 observed cost per benchmark message. The runner automatically stops if cumulative API spending approaches the $20 project budget.

## 6. n8n Migration

In production, n8n should handle integration and transport rather than business policy:

1. Zalo/Email triggers an n8n workflow.
2. n8n normalizes metadata and calls `POST /v1/orders/process`.
3. The TypeScript engine executes the complete policy pipeline.
4. n8n receives `QUOTE`, `ASK`, `ESCALATE`, or `DO_NOTHING` and handles channel-specific delivery.

This keeps business rules centralized instead of duplicating them across workflow nodes.

## 7. AI Tools Used

* **ChatGPT Web:** Used for research, brainstorming, and structuring the overall solution.
* **Antigravity CLI:** Used to orchestrate coding agents through workflows such as **Superpowers**, covering planning, implementation, debugging, review, and iterative development.

## 8. Known Gaps

* **Multi-line orders:** Currently optimized for single-product orders. Compound baskets would require list-based extraction in `OrderIntent` (`src/domain/models.ts`).
* **Unit conversions:** Standard units such as `thùng`, `kg`, and `hộp` are supported; complex fractional conversions require dedicated conversion rules.
