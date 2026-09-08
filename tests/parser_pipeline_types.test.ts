import test from "node:test";
import assert from "node:assert";
import { GeminiResponseParserClass, detectTurnSchemaDrift } from "../src/core/api/geminiParser.js";
import * as parseDetailMod from "../src/core/api/parser/parseDetail.js";
import * as extractorsMod from "../src/core/api/parser/extractors.js";


test("TDD Red: isTurn must accept r_ prefixed turn IDs in addition to c_ prefixed turn IDs", () => {
    // Both c_ and r_ prefixes are used by Google Gemini JSPB payloads
    const turnWithR = [
        ["r_testturn123", "rc_candidate1"],
        [1700000000, 0],
        [["User prompt text"]],
        [[["rc_response1", [["Model response text"]]]]]
    ];

    assert.strictEqual(
        parseDetailMod.isTurn(turnWithR),
        true,
        "isTurn must recognize turns with r_ prefix as valid turns"
    );
});

test("TDD Red: detectTurnSchemaDrift must return complete structured drift diagnosis", () => {
    // Corrupted turn: missing model payload and candidates
    const corruptedTurn = [
        ["c_corrupt123"],
        [1700000000, 0],
        "not an array payload"
    ];

    const drift = extractorsMod.detectTurnSchemaDrift(corruptedTurn, "test_conv");
    assert.strictEqual(typeof drift.isDrifted, "boolean");
    assert.strictEqual(drift.isDrifted, true);
    assert.ok(Array.isArray(drift.warnings) && drift.warnings.length > 0);
});

test("TDD Red: robustFirstPayload parses nested JSON strings with brackets inside quotes", () => {
    const jsonWithBracketsInString = JSON.stringify([
        ["wrb.fr", "hNvQHb", JSON.stringify([["c_123", "Title with [brackets] inside", "data"]])]
    ]);
    const rpcText = `)]}'

${jsonWithBracketsInString}`;
    const parsed = extractorsMod.robustFirstPayload(rpcText) as any[][];
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0][0], "wrb.fr");
    assert.strictEqual(parsed[0][1], "hNvQHb");
});
