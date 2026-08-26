import { describe, it, expect, vi } from "vitest";
import { OllamaProvider } from "../src/agents/llmProvider.js";
import type { ProviderMessage } from "../src/agents/llmProvider.js";

// OllamaProvider talks to a real Ollama server's /api/chat over the network,
// which is unreachable from this sandbox (and shouldn't be a test dependency
// anyway) -- so every test here injects a fake fetchImpl instead. Real,
// live verification happens on a machine with `ollama serve` running (see
// README / SPEC for setup steps).

function mockFetch(responseBody: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  });
}

describe("OllamaProvider", () => {
  it("sends a system message, the user prompt, and OpenAI-function-shaped tools", async () => {
    const fetchImpl = mockFetch({ message: { content: "", tool_calls: [] } });
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "qwen2.5:7b", fetchImpl });

    const messages: ProviderMessage[] = [
      { role: "user", content: [{ type: "text", text: "New intake to triage." }] },
    ];

    await provider.nextTurn(messages, { systemPrompt: "You are a triage assistant." });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are a triage assistant." });
    expect(body.messages[1]).toEqual({ role: "user", content: "New intake to triage." });

    // Tools converted from Anthropic's {name, description, input_schema}
    // shape into OpenAI-function {type: "function", function: {...}}.
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("get_patient_history");
    expect(body.tools[0].function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("parses tool_calls with object arguments into ProviderToolCall[]", async () => {
    const fetchImpl = mockFetch({
      message: {
        content: "",
        tool_calls: [
          { id: "call-1", function: { name: "flag_risk_level", arguments: { risk_level: "low", justification: "stable" } } },
        ],
      },
    });
    const provider = new OllamaProvider({ fetchImpl });

    const turn = await provider.nextTurn([], { systemPrompt: "x" });

    expect(turn.toolCalls).toEqual([
      { id: "call-1", name: "flag_risk_level", input: { risk_level: "low", justification: "stable" } },
    ]);
    expect(turn.text).toBeNull();
  });

  it("defensively parses tool_calls whose arguments arrive as a JSON string", async () => {
    const fetchImpl = mockFetch({
      message: {
        content: "",
        tool_calls: [
          { function: { name: "request_human_review", arguments: '{"reason":"routine triage complete"}' } },
        ],
      },
    });
    const provider = new OllamaProvider({ fetchImpl });

    const turn = await provider.nextTurn([], { systemPrompt: "x" });

    expect(turn.toolCalls[0].name).toBe("request_human_review");
    expect(turn.toolCalls[0].input).toEqual({ reason: "routine triage complete" });
    // No id from the server -- provider synthesizes a stable placeholder.
    expect(turn.toolCalls[0].id).toBe("ollama-call-0");
  });

  it("falls back to an empty object when a string argument fails to parse", async () => {
    const fetchImpl = mockFetch({
      message: { content: "", tool_calls: [{ function: { name: "get_patient_history", arguments: "not json" } }] },
    });
    const provider = new OllamaProvider({ fetchImpl });

    const turn = await provider.nextTurn([], { systemPrompt: "x" });
    expect(turn.toolCalls[0].input).toEqual({});
  });

  it("returns plain text with no tool calls when the model just replies", async () => {
    const fetchImpl = mockFetch({ message: { content: "All done here." } });
    const provider = new OllamaProvider({ fetchImpl });

    const turn = await provider.nextTurn([], { systemPrompt: "x" });
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).toBe("All done here.");
  });

  it("round-trips a prior assistant tool_use + tool_result turn into Ollama's flat message shape", async () => {
    const fetchImpl = mockFetch({ message: { content: "", tool_calls: [] } });
    const provider = new OllamaProvider({ fetchImpl });

    const messages: ProviderMessage[] = [
      { role: "user", content: [{ type: "text", text: "Begin triage." }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call-1", name: "get_patient_history", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call-1", content: '{"event_count":0}' }],
      },
    ];

    await provider.nextTurn(messages, { systemPrompt: "sys" });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "Begin triage." },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", function: { name: "get_patient_history", arguments: {} } }],
      },
      { role: "tool", content: '{"event_count":0}', tool_name: "get_patient_history" },
    ]);
  });

  it("throws a descriptive error when the server responds non-OK", async () => {
    const fetchImpl = mockFetch({ error: "model not found" }, false, 404);
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "qwen2.5:7b", fetchImpl });

    await expect(provider.nextTurn([], { systemPrompt: "x" })).rejects.toThrow(/404/);
    await expect(provider.nextTurn([], { systemPrompt: "x" })).rejects.toThrow(/ollama serve/);
  });

  it("defaults baseUrl and model from env vars, and strips a trailing slash", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/";
    process.env.OLLAMA_MODEL = "llama3.1:8b";
    const fetchImpl = mockFetch({ message: { content: "", tool_calls: [] } });
    const provider = new OllamaProvider({ fetchImpl });

    await provider.nextTurn([], { systemPrompt: "x" });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("llama3.1:8b");

    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  });
});
