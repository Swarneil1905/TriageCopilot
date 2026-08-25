import { AGENT_TOOLS, ToolName } from "./tools.js";

// Message/turn shapes deliberately mirror Anthropic's Messages API content-block
// format (text / tool_use / tool_result), so AnthropicProvider is a thin pass-
// through and FakeProvider can stand in for it with zero SDK dependency --
// the orchestrator (Task 4) is written against this interface only and does
// not know or care which implementation is live.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ProviderMessage =
  | { role: "user"; content: Array<TextBlock | ToolResultBlock> }
  | { role: "assistant"; content: Array<TextBlock | ToolUseBlock> };

export interface ProviderToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ProviderTurn {
  toolCalls: ProviderToolCall[];
  text: string | null;
}

export interface NextTurnOptions {
  systemPrompt: string;
  tools?: typeof AGENT_TOOLS;
}

export interface LLMProvider {
  nextTurn(messages: ProviderMessage[], opts: NextTurnOptions): Promise<ProviderTurn>;
}

// ---------------------------------------------------------------------------
// FakeProvider: deterministic, zero-network, zero-API-key. Scripts a fixed
// sequence of turns so tests (and the whole demo, by default) never depend
// on a live model. This is also the shape you'd want for agent evals in CI --
// no LLM spend to exercise the orchestrator's control flow.
// ---------------------------------------------------------------------------

export interface FakeProviderConfig {
  /** One entry consumed per call to nextTurn, in order. */
  script: ProviderTurn[];
  /**
   * If set, the first N calls to nextTurn throw instead of consuming the
   * script -- simulates a flaky LLM API for exercising retry/backoff.
   */
  failFirstNCalls?: number;
}

export class FakeProvider implements LLMProvider {
  private callCount = 0;

  constructor(private config: FakeProviderConfig) {}

  async nextTurn(): Promise<ProviderTurn> {
    const n = this.callCount++;
    const failures = this.config.failFirstNCalls ?? 0;

    if (n < failures) {
      throw new Error("Simulated LLM provider failure (FakeProvider.failFirstNCalls)");
    }

    const scriptIndex = n - failures;
    const turn = this.config.script[scriptIndex];
    if (!turn) {
      // Script exhausted: model has nothing further to say. The orchestrator
      // treats "no tool calls left" as the model believing it's done --
      // which is exactly the case the forced-handoff guardrail exists for.
      return { toolCalls: [], text: null };
    }
    return turn;
  }
}

// ---------------------------------------------------------------------------
// AnthropicProvider: thin wrapper over @anthropic-ai/sdk's tool-use API.
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
  private clientPromise: Promise<any>;
  private model: string;

  constructor(apiKey: string, model?: string) {
    // Lazy/dynamic import so FakeProvider-only usage (tests, the default
    // demo) never needs @anthropic-ai/sdk to actually resolve a live client.
    this.clientPromise = import("@anthropic-ai/sdk").then(
      (mod) => new mod.default({ apiKey })
    );
    // Check docs.claude.com/en/docs/about-claude/models for the current
    // model id -- this is a sensible default, not a guarantee it's latest.
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  }

  async nextTurn(messages: ProviderMessage[], opts: NextTurnOptions): Promise<ProviderTurn> {
    const client = await this.clientPromise;
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: opts.systemPrompt,
      messages,
      tools: opts.tools ?? AGENT_TOOLS,
    });

    const toolCalls: ProviderToolCall[] = [];
    let text: string | null = null;

    for (const block of res.content as any[]) {
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      } else if (block.type === "text") {
        text = (text ?? "") + block.text;
      }
    }

    return { toolCalls, text };
  }
}

export function makeLLMProvider(): LLMProvider {
  const kind = process.env.LLM_PROVIDER ?? "fake";
  if (kind === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.");
    }
    return new AnthropicProvider(apiKey);
  }
  // Default fake script: a well-behaved run that calls every tool in the
  // expected order, including the mandatory human-review handoff. Callers
  // that want a different script (e.g. tests) should construct their own
  // FakeProvider directly rather than going through this factory.
  return new FakeProvider({
    script: [
      { toolCalls: [{ id: "call-1", name: "get_patient_history", input: {} }], text: null },
      {
        toolCalls: [
          {
            id: "call-2",
            name: "flag_risk_level",
            input: { risk_level: "low", justification: "no acute risk indicators in intake" },
          },
        ],
        text: null,
      },
      {
        toolCalls: [
          {
            id: "call-3",
            name: "draft_clinical_summary",
            input: {
              summary: "Patient reports mild, situational low mood; no acute risk indicators.",
              recommended_next_step: "Routine follow-up in 2 weeks.",
            },
          },
        ],
        text: null,
      },
      {
        toolCalls: [
          { id: "call-4", name: "request_human_review", input: { reason: "routine triage complete" } },
        ],
        text: null,
      },
    ],
  });
}
