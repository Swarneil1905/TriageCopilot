import { describe, it, expect } from "vitest";
import { FakeProvider } from "../src/agents/llmProvider.js";

describe("FakeProvider", () => {
  it("returns scripted turns in order", async () => {
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null },
        {
          toolCalls: [{ id: "2", name: "request_human_review", input: { reason: "done" } }],
          text: null,
        },
      ],
    });

    const first = await provider.nextTurn([], { systemPrompt: "" });
    expect(first.toolCalls[0].name).toBe("get_patient_history");

    const second = await provider.nextTurn([], { systemPrompt: "" });
    expect(second.toolCalls[0].name).toBe("request_human_review");
  });

  it("returns an empty final turn once the script is exhausted", async () => {
    const provider = new FakeProvider({
      script: [{ toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null }],
    });

    await provider.nextTurn([], { systemPrompt: "" });
    const afterScript = await provider.nextTurn([], { systemPrompt: "" });
    expect(afterScript.toolCalls).toEqual([]);
    expect(afterScript.text).toBeNull();
  });

  it("throws for the configured number of calls before consuming the script (simulated flakiness)", async () => {
    const provider = new FakeProvider({
      failFirstNCalls: 2,
      script: [{ toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null }],
    });

    await expect(provider.nextTurn([], { systemPrompt: "" })).rejects.toThrow(/Simulated/);
    await expect(provider.nextTurn([], { systemPrompt: "" })).rejects.toThrow(/Simulated/);

    // Third call succeeds and consumes script index 0.
    const third = await provider.nextTurn([], { systemPrompt: "" });
    expect(third.toolCalls[0].name).toBe("get_patient_history");
  });
});
