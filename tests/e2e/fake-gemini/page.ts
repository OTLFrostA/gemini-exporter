import type { FakeGeminiScenario } from './harness';

/**
 * Minimal *website* shell, not a replica of Google's design.
 * The extension is loaded from its real MV3 manifest into this HTTPS origin.
 * Only this page and network replies are controlled by the test harness.
 */
function html(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderFakeGeminiPage(scenario: FakeGeminiScenario, path: string): string {
    const selectedId = /^\/(?:u\/\d+\/)?app\/([a-f0-9]{8,64})(?:\/|$)/i.exec(path)?.[1]
        ?? scenario.conversations[0]?.id ?? '';
    const selected = scenario.conversations.find(item => item.id === selectedId);
    const navigation = scenario.conversations.map(item =>
        '<a href="/app/' + html(item.id) + '">' + html(item.title) + (item.pinned ? ' 📌' : '') + '</a>'
    ).join('\n');
    const wiz = JSON.stringify({
        qDCSke: scenario.gaiaId, oPEP7c: scenario.email,
        SNlM0e: 'synthetic-at-token-not-a-real-secret',
        cfb2h: 'boq_assistant-bard-web-server_fake_test_only',
    }).replace(/</g, '\\u003c');

    const pageScript = [
        '(() => {',
        '  const currentId = ' + JSON.stringify(selectedId) + ';',
        "  const status = document.getElementById('fakeStatus');",
        "  const results = document.getElementById('fakeResults');",
        '  let cursor = null;',
        "  function show(message) { status.textContent = message; }",
        '  async function rpc(id, args) {',
        '    const batch = [[[id, JSON.stringify(args), null, "generic"]]];',
        '    const body = new URLSearchParams();',
        '    body.set("f.req", JSON.stringify(batch));',
        '    body.set("at", window.WIZ_global_data.SNlM0e);',
        '    const url = "/_/BardChatUi/data/batchexecute?rpcids=" + encodeURIComponent(id) + "&f.sid=synthetic&bl=boq_test";',
        '    const reply = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });',
        '    if (!reply.ok) throw new Error(id + " HTTP " + reply.status);',
        '    const text = (await reply.text()).replace(/^\\)\\]\\}\\x27\\s*/, "").trim();',
        '    const rows = JSON.parse(text);',
        '    const row = rows.find(item => Array.isArray(item) && item[0] === "wrb.fr" && item[1] === id);',
        '    return row ? JSON.parse(row[2]) : null;',
        '  }',
        '  async function action(name, callback) {',
        '    show(name + " running");',
        '    try { await callback(); show(name + " complete"); }',
        '    catch (error) { show(name + " failed: " + (error instanceof Error ? error.message : String(error))); }',
        '  }',
        '  async function loadList() {',
        '    const response = await rpc("MaZiqc", [50, cursor, [0, null, 1]]);',
        '    const items = Array.isArray(response?.[2]) ? response[2] : [];',
        '    for (const item of items) {',
        '      const row = document.createElement("li");',
        '      row.textContent = typeof item[1] === "string" ? item[1] : "(untitled)";',
        '      results.append(row);',
        '    }',
        '    cursor = typeof response?.[1] === "string" ? response[1] : null;',
        '    document.getElementById("fakeLoadMore").disabled = cursor === null;',
        '  }',
        '  document.getElementById("fakeLoadList").addEventListener("click", () => action("List", async () => {',
        '    cursor = null; results.replaceChildren(); await loadList();',
        '  }));',
        '  document.getElementById("fakeLoadMore").addEventListener("click", () => action("Next page", loadList));',
        '  document.getElementById("fakeLoadDetail").addEventListener("click", () => action("Detail", async () => {',
        '    if (!currentId) throw new Error("open a conversation first");',
        '    const result = await rpc("hNvQHb", ["c_" + currentId, 10, null, 1, [1], [4], null, 1]);',
        '    document.getElementById("fakeDetail").textContent = JSON.stringify(result);',
        '  }));',
        '  document.getElementById("fakeLoadGems").addEventListener("click", () => action("Gems", async () => {',
        '    await rpc("CNgdBe", []);',
        '  }));',
        '  document.getElementById("fakeDelete").addEventListener("click", () => action("Delete", async () => {',
        '    if (!currentId) throw new Error("open a conversation first");',
        '    await rpc("GzXR5e", ["c_" + currentId]);',
        '  }));',
        '  document.getElementById("fakeSend").addEventListener("click", () => action("Stream", async () => {',
        '    if (!currentId) throw new Error("open a conversation first");',
        '    const prompt = document.getElementById("fakePrompt").value;',
        '    const body = new URLSearchParams({ "f.req": JSON.stringify(["c_" + currentId, prompt]) });',
        '    const reply = await fetch("/_/BardChatUi/data/StreamGenerate", { method: "POST", body });',
        '    if (!reply.ok) throw new Error("Stream HTTP " + reply.status);',
        '    await reply.text();',
        '    document.getElementById("fakeAnswer").textContent = "Synthetic answer returned (not real Gemini)";',
        '  }));',
        '})();',
    ].join('\n');

    return [
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<link rel="icon" href="data:,"><title>Gemini — Offline Test Harness</title>',
        '<style>',
        '*{box-sizing:border-box}body{margin:0;background:#f7f8fc;color:#252637;font:14px/1.5 Arial,sans-serif}',
        '.layout{display:grid;grid-template-columns:250px 1fr;min-height:100vh}',
        'aside{padding:24px 16px;background:#eceff7}nav{display:grid;gap:12px}',
        'nav a{display:block;color:#303b66;text-decoration:none;overflow-wrap:anywhere}',
        'main{padding:28px;max-width:960px}h1{font-size:25px;margin:0 0 4px}',
        '.notice{color:#675b3c}button,textarea{font:inherit}button{padding:8px 12px;border:1px solid #abb5cd;border-radius:8px;background:white;cursor:pointer}',
        'button:disabled{opacity:.4;cursor:not-allowed}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}',
        'textarea{width:100%;max-width:660px;min-height:85px;padding:12px;border:1px solid #bec6db;border-radius:8px}',
        '#fakeStatus{font:12px monospace;padding:10px;background:#e9eefa;border-radius:7px}',
        '#fakeDetail{max-height:200px;overflow:auto;word-break:break-word;font:12px monospace}',
        '</style>',
        '<script>window.WIZ_global_data=' + wiz + ';</script>',
        '</head><body data-testid="fake-gemini-root"><div class="layout">',
        '<aside><strong>Gemini · Offline fixture</strong>',
        '<nav aria-label="Conversations">' + navigation + '</nav>',
        '<p><button aria-label="Google Account: Fixture User (' + html(scenario.email) + ')">Fixture Account</button></p>',
        '</aside><main>',
        '<h1>' + html(selected?.title ?? 'New conversation') + '</h1>',
        '<p class="notice">Synthetic test site served at gemini.google.com via Playwright. Not a real Google page.</p>',
        '<div class="actions">',
        '<button id="fakeLoadList">Load conversations</button>',
        '<button id="fakeLoadMore" disabled>Load next page</button>',
        '<button id="fakeLoadDetail">Load detail</button>',
        '<button id="fakeLoadGems">Load gems</button>',
        '<button id="fakeDelete">Delete conversation</button>',
        '</div><ol id="fakeResults"></ol><pre id="fakeDetail"></pre>',
        '<label for="fakePrompt">Ask (synthetic stream)</label><p><textarea id="fakePrompt">Hello, offline Gemini!</textarea></p>',
        '<p><button id="fakeSend">Send message</button></p><div id="fakeAnswer"></div>',
        '<div id="fakeStatus" role="status">Ready</div>',
        '</main></div><script>' + pageScript.replace(/<\//g, '<\\/') + '</script></body></html>',
    ].join('\n');
}
