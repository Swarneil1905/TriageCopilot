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

// ---------------------------------------------------------------------------
// OllamaProvider: native tool-calling against a local Ollama server's
// /api/chat endpoint (see https://github.com/ollama/ollama/blob/main/docs/api.md).
// Ollama accepts an OpenAI-function-shaped `tools` array and returns
// `message.tool_calls` in that same shape, so the real work here is
// translating between that flat {role, content} message format and the
// Anthropic-shaped ProviderMessage the orchestrator uses everywhere else --
// AnthropicProvider is a pass-through, this one is a real adapter.
//
// This can't be exercised against a live server from this sandbox (no
// outbound access to a local Ollama install), so it's unit-tested below
// against a mocked fetch, and verified for real by running `ollama serve`
// with a tool-calling-capable model pulled (e.g. `ollama pull qwen2.5:7b`)
// on your own machine.
// ---------------------------------------------------------------------------

interface OllamaFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface OllamaToolCall {
  id?: string;
  function: {
    name: string;
    // Ollama's docs show this as a parsed object, but some models/versions
    // return a JSON-encoded string -- handle both defensively.
    arguments: Record<string, unknown> | string;
  };
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

function toolsToOllamaFormat(tools: typeof AGENT_TOOLS): OllamaFunctionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Flattens the Anthropic-shaped ProviderMessage list into Ollama's simple
 * {role, content} list, prefixed with a system message. The one wrinkle: a
 * ToolResultBlock only carries the tool_use_id it's answering, not the
 * tool's name, so we track id -> name from the tool_use blocks already seen
 * as we walk forward and attach it as tool_name on the resulting message.
 */
function toOllamaMessages(messages: ProviderMessage[], systemPrompt: string): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: "system", content: systemPrompt }];
  const nameForId = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b): b is TextBlock => b.type === "text");
      const toolUseBlocks = msg.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      for (const tb of toolUseBlocks) nameForId.set(tb.id, tb.name);

      out.push({
        role: "assistant",
        content: textBlocks.map((b) => b.text).join(""),
        ...(toolUseBlocks.length > 0
          ? {
              tool_calls: toolUseBlocks.map((tb) => ({
                id: tb.id,
                function: { name: tb.name, arguments: tb.input },
              })),
            }
          : {}),
      });
    } else {
      for (const block of msg.content) {
        if (block.type === "text") {
          out.push({ role: "user", content: block.text });
        } else {
          out.push({
            role: "tool",
            content: block.content,
            tool_name: nameForId.get(block.tool_use_id),
          });
        }
      }
    }
  }

  return out;
}

function parseToolArguments(raw: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export interface OllamaProviderConfig {
  baseUrl?: string;
  model?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private fetchImpl: typeof fetch;

  constructor(config: OllamaProviderConfig = {}) {
    // Trim a trailing slash so `${baseUrl}/api/chat` never ends up with `//`.
    this.baseUrl = (config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(
      /\/$/,
      ""
    );
    this.model = config.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async nextTurn(messages: ProviderMessage[], opts: NextTurnOptions): Promise<ProviderTurn> {
    const tools = opts.tools ?? AGENT_TOOLS;

    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOllamaMessages(messages, opts.systemPrompt),
        tools: toolsToOllamaFormat(tools),
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Ollama request to ${this.baseUrl}/api/chat failed (${res.status} ${res.statusText}). ` +
          `Is 'ollama serve' running and is ${this.model} pulled? ${body}`
      );
    }

    const data = (await res.json()) as {
      message?: { content?: string; tool_calls?: OllamaToolCall[] };
    };
    const message = data.message ?? {};
    const rawToolCalls = message.tool_calls ?? [];

    const toolCalls: ProviderToolCall[] = rawToolCalls.map((tc, i) => ({
      id: tc.id ?? `ollama-call-${i}`,
      name: tc.function.name as ToolName,
      input: parseToolArguments(tc.function.arguments),
    }));

    return {
      toolCalls,
      text: message.content && message.content.length > 0 ? message.content : null,
    };
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
  if (kind === "ollama") {
    // baseUrl/model fall back to OLLAMA_BASE_URL / OLLAMA_MODEL env vars (or
    // localhost:11434 / qwen2.5:7b) inside the constructor when omitted here.
    return new OllamaProvider({});
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
