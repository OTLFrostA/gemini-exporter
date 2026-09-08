import test from "node:test";
import assert from "node:assert";
import { GeminiAPIClient } from "../src/core/api/geminiClient.js";
import * as paginationMod from "../src/core/api/client/pagination.js";
import * as retryPolicyMod from "../src/core/api/client/retryPolicy.js";
import * as rpcClientMod from "../src/core/api/client/rpcClient.js";

test("TDD Red: getAllConversations must respect opts.signal when passed in options", async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted

    const mockClient = {
        aborted: false,
        isAborted: () => false,
        getConversationList: async () => {
            return { conversations: [{ id: "c_1", title: "Chat 1" }], nextPageToken: "tC_2" };
        }
    };

    const res = await paginationMod.getAllConversations(mockClient as any, {
        maxPages: 10,
        signal: controller.signal
    });

    assert.strictEqual(res.conversations.length, 0, "Should abort immediately when opts.signal is aborted");
    assert.ok(res.diagnostics.stopReason.includes("终止"), "Stop reason should indicate aborted");
});

test("TDD Red: retryPolicy.handleHttp429 must return structured backoff metadata", async () => {
    const mockResp = {
        status: 429,
        headers: {
            get: (h: string) => (h.toLowerCase() === "retry-after" ? "0" : null)
        }
    };

    // Test with maxRetries exceeded
    const exceeded = await retryPolicyMod.handleHttp429({
        resp: mockResp as any,
        retryCount: 3,
        maxRetries: 3
    });
    assert.strictEqual(exceeded.shouldRetry, false);
});


test("TDD Red: rpcClient.getApiUrl handles both u0/u1 and /u/0 formats", () => {
    assert.strictEqual(rpcClientMod.getApiUrl("default"), "https://gemini.google.com/_/BardChatUi/data/batchexecute");
    assert.strictEqual(rpcClientMod.getApiUrl("u1"), "https://gemini.google.com/u/1/_/BardChatUi/data/batchexecute");
});
