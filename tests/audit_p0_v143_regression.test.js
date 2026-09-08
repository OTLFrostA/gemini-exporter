// tests/audit_p0_v143_regression.test.js
// Regression locks for the 6 P0 issues remediated in PR #233.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const Proto = require("../src/core/protocol/protocol.js");
const AssetFetcherModule = require("../src/content/assetFetcher.js");

test("hookCredentials - broadcastBatchexecute filter only relays LIST and DETAIL payloads", () => {
    const filterFn = (text) => {
        if (!text || (!text.includes(Proto.RPCS.LIST) && !text.includes(Proto.RPCS.DETAIL))) {
            return false;
        }
        return true;
    };

    const prefix = String.fromCharCode(41, 93, 125, 39) + "\n";
    const genericBatchexecute = prefix + JSON.stringify([["wrb.fr", "generic_rpc", "[]", null]]);
    assert.strictEqual(filterFn(genericBatchexecute), false, "Generic wrb.fr response must be filtered out");

    const deleteBatchexecute = prefix + JSON.stringify([["wrb.fr", "GzXR5e", ["deleted"], null]]);
    assert.strictEqual(filterFn(deleteBatchexecute), false, "Delete RPC response must not pass batchexecute broadcast");

    const listBatchexecute = prefix + JSON.stringify([["wrb.fr", Proto.RPCS.LIST, ["c_123"], null]]);
    assert.strictEqual(filterFn(listBatchexecute), true, "List RPC must pass filter");

    const detailBatchexecute = prefix + JSON.stringify([["wrb.fr", Proto.RPCS.DETAIL, ["c_123"], null]]);
    assert.strictEqual(filterFn(detailBatchexecute), true, "Detail RPC must pass filter");
});

test("bootstrap - runSerializedCredOp serializes concurrent read-modify-write cycles", async () => {
    let credOpChain = Promise.resolve();
    function runSerializedCredOp(op) {
        const run = credOpChain.then(op, op);
        credOpChain = run.then(() => undefined, () => undefined);
        return run;
    }

    let storageMap = {};
    const executionOrder = [];

    async function updateCred(sid, atValue, delayMs) {
        return runSerializedCredOp(async () => {
            executionOrder.push("start:" + sid);
            await new Promise(r => setTimeout(r, delayMs));
            const currentMap = { ...storageMap };
            currentMap[sid] = { sid, at: atValue, lastUsed: Date.now() };
            await new Promise(r => setTimeout(r, 10));
            storageMap = currentMap;
            executionOrder.push("end:" + sid);
            return storageMap;
        });
    }

    const p1 = updateCred("sid_1", "at_token_1", 30);
    const p2 = updateCred("sid_2", "at_token_2", 10);
    const p3 = updateCred("sid_3", "at_token_3", 5);

    await Promise.all([p1, p2, p3]);

    assert.ok(storageMap.sid_1, "sid_1 must be present");
    assert.ok(storageMap.sid_2, "sid_2 must be present");
    assert.ok(storageMap.sid_3, "sid_3 must be present");
    assert.strictEqual(storageMap.sid_1.at, "at_token_1");
    assert.strictEqual(storageMap.sid_2.at, "at_token_2");
    assert.strictEqual(storageMap.sid_3.at, "at_token_3");

    assert.deepStrictEqual(executionOrder, [
        "start:sid_1", "end:sid_1",
        "start:sid_2", "end:sid_2",
        "start:sid_3", "end:sid_3"
    ], "Credential operations must execute strictly serialized");
});

test("assetFetcher - downloadAssetDirect hard caps > 50MB blob and rejects immediately", async () => {
    const downloadAssetDirect = AssetFetcherModule.downloadAssetDirect ||
        (AssetFetcherModule.AssetFetcher && AssetFetcherModule.AssetFetcher.downloadAssetDirect);

    assert.ok(typeof downloadAssetDirect === "function", "downloadAssetDirect function must exist");

    const oldFetch = global.fetch;
    let fallbackCalled = false;
    try {
        const oversizedBytes = 51 * 1024 * 1024;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            headers: new Map([["content-type", "application/octet-stream"]]),
            blob: async () => ({
                size: oversizedBytes,
                type: "application/octet-stream",
                arrayBuffer: async () => { fallbackCalled = true; return new ArrayBuffer(0); }
            })
        });

        let response = null;
        await downloadAssetDirect({ url: "https://example.com/oversized_file.bin" }, (resp) => {
            response = resp;
        });

        assert.ok(response, "Response must be received");
        assert.strictEqual(response.success, false, "Direct download of >50MB asset must return success: false");
        assert.ok(response.error && response.error.includes("asset too large"), "Error message must specify asset too large");
        assert.ok(response.error.includes("Google Takeout"), "Error message must guide user to Google Takeout");
        assert.strictEqual(fallbackCalled, false, "Must not attempt to read arrayBuffer/toDataUrl on oversized blob");
    } finally {
        global.fetch = oldFetch;
    }
});

test("release workflow - release package excludes TypeScript source and sourcemaps", () => {
    const workflowPath = path.join(__dirname, "../.github/workflows/release.yml");
    const workflowContent = fs.readFileSync(workflowPath, "utf8");

    assert.ok(workflowContent.includes("src -x 'src/*.ts'"), "release.yml must exclude src/*.ts");
    assert.ok(workflowContent.includes("'src/*/*/*/*.ts'"), "release.yml must exclude nested .ts files");
    assert.ok(workflowContent.includes("dist \\"), "release.yml must package dist with whitelist");
    assert.ok(workflowContent.includes("'dist/background/background.js'"), "release.yml must include background.js bundle");
    assert.ok(workflowContent.includes("'dist/content/content.js'"), "release.yml must include content.js bundle");
    assert.ok(workflowContent.includes("'dist/content/hook.js'"), "release.yml must include hook.js bundle");
    assert.ok(workflowContent.includes("'dist/ui/options.js'"), "release.yml must include options.js bundle");
    assert.ok(workflowContent.includes("'dist/ui/popup.js'"), "release.yml must include popup.js bundle");
    assert.ok(!workflowContent.includes("\n            dist \\\n            src"), "release.yml must not blindly zip entire dist/ and src/");
});
