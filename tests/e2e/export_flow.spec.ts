import { test, expect } from './fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';

const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));

test.describe('Export Workflow & State Update', () => {
  test('should trigger batch export, update progress, and mark conversations as exported', async ({ context, extensionId }) => {
    // 1. Open mock Gemini page in background with valid credentials and network routing
    const geminiPage = await context.newPage();

    await geminiPage.route('https://gemini.google.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html>
        <html>
        <head>
          <script>
            window._WIZ_global_data = {
              qDCSke: '10000000001', SNlM0e: 'mock_at_token_123',
              cfb2h: 'boq_assistant-bard-web-server_20260802.09_p1'
            };
          </script>
        </head>
        <body>Gemini Mock Session Active</body>
        </html>`
      });
    });

    const turns = [
      [
        ["c_exp_chat_001"],
        "turn_id_1",
        [["请概述深度学习神经网络的实践要点。"]],
        [
          [
            ["rc_cand_1", ["深度学习神经网络实践包含数据预处理、模型架构设计、超参数调优与正则化等关键环节。"]]
          ]
        ]
      ]
    ];
    const mockDetailInner = JSON.stringify([
      turns,
      null, // This fixture is a terminal detail page.
      "深度学习神经网络实践"
    ]);
    const mockRpcResponse = `)]}'\n\n[["wrb.fr","hNvQHb",${JSON.stringify(mockDetailInner)}]]`;

    await geminiPage.route('**/batchexecute*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: mockRpcResponse
      });
    });

    await geminiPage.goto('https://gemini.google.com/app');
    await geminiPage.waitForLoadState('domcontentloaded');

    // 2. Open Workbench Options page
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.waitForLoadState('domcontentloaded');

    // Seed test conversation
    await page.evaluate(async () => {
      const mockConvs = [
        { id: 'exp_chat_001', title: '深度学习神经网络实践', timestamp: 1700000000000 }
      ];
      await chrome.storage.local.set({
        gemini_conversations: (mockConvs).map(canonicalIndexFixture),
        exportedIds: {},
        has_completed_tour: true,
        last_seen_feature_version: '999.0.0'
      });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    // Wait for item to be rendered in DOM
    const item = page.locator('[data-chat-id="exp_chat_001"]');
    await expect(item).toBeVisible();

    // 3. Select the exact format; do not rely on whichever format was last saved.
    await page.selectOption('#format', 'markdown');
    await page.locator('#includeZip').check();
    await page.click('#btnSelectAll');
    await expect(page.locator('#list input[type=checkbox]:checked')).toHaveCount(1);

    // 4. Trigger real Export through clicking #btnExport and wait for download
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.click('#btnExport');

    const download = await downloadPromise;
    const zipPath = await download.path();
    expect(zipPath).toBeTruthy();
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath!));
    const markdownNames = Object.keys(zip.files).filter(name => name.endsWith('.md') && !zip.files[name].dir);
    expect(markdownNames).toHaveLength(1);
    const markdown = await zip.files[markdownNames[0]].async('text');
    expect(markdown).toContain('请概述深度学习神经网络的实践要点');
    expect(markdown).toContain('数据预处理');
    expect(markdown).toContain('模型架构设计');

    // 5. Verify the *exported* badge rather than any unrelated status badge.
    await expect(item.locator('.badge-exported')).toContainText(/已导出|Exported/);

    // 6. Verify Storage contains valid export record persisted by ExportEngine
    const storageData = await page.evaluate(async () => {
      return await chrome.storage.local.get(['exportedIds']);
    }) as Record<string, any>;
    const record = storageData.exportedIds['exp_chat_001'];
    expect(record).toBeTruthy();
    expect(record.title).toBe('深度学习神经网络实践');
    expect(record.format).toBe('markdown');
    expect(record.status).toBe('ok');
  });

  test('should fast-skip already exported items without generating empty zip', async ({ context, extensionId }) => {
    // 1. Open Workbench Options page
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.waitForLoadState('domcontentloaded');

    // Seed test conversation and mark it already exported in exportedIds
    await page.evaluate(async () => {
      const mockConvs = [
        { id: 'exp_chat_skip_001', title: '跳过测试会话', timestamp: 1700000000000 }
      ];
      await chrome.storage.local.set({
        gemini_conversations: (mockConvs).map(canonicalIndexFixture),
        gemini_export_zip: true,
        exportedIds: {
          'exp_chat_skip_001': {
            exportedAt: 1700000000000,
            title: '跳过测试会话'
          }
        }
      });
      if (typeof (window as any).__workbenchLoadStore === 'function') {
        await (window as any).__workbenchLoadStore(true);
      }
    });

    const item = page.locator('[data-chat-id="exp_chat_skip_001"]');
    await expect(item).toBeVisible();

    // Select the conversation
    await page.click('#btnSelectAll');
    await expect(page.locator('#list input[type=checkbox]:checked')).toHaveCount(1);

    // Ensure skipExported is checked
    const skipCheckbox = page.locator('#skipExported');
    if (!(await skipCheckbox.isChecked())) {
      await skipCheckbox.check();
    }

    // Ensure includeZip is checked
    const zipCheckbox = page.locator('#includeZip');
    if (!(await zipCheckbox.isChecked())) {
      await zipCheckbox.check();
    }

    // Listen BEFORE the click and keep the window open after completion. A
    // synchronous flag checked immediately after a UI update misses late ZIPs.
    const unexpectedDownload = page.waitForEvent('download', { timeout: 1500 })
      .then(() => true, error => {
        if (String(error).includes('Timeout')) return false;
        throw error;
      });
    await page.click('#btnExport');

    // Verify fast-skip log and notification in progress area
    await expect(page.locator('#progText')).toContainText(/(跳过|skipped|无需生成 ZIP)/);

    // Verify export button becomes active again quickly (not stuck in disabled state)
    await expect(page.locator('#btnExport')).toBeEnabled();

    // Assert no empty ZIP appeared even after the completion UI settled.
    expect(await unexpectedDownload).toBe(false);
    const stored = await page.evaluate(async () => chrome.storage.local.get('exportedIds')) as { exportedIds: Record<string, { exportedAt: number }> };
    expect(Object.keys(stored.exportedIds || {})).toEqual(['exp_chat_skip_001']);
    expect(stored.exportedIds['exp_chat_skip_001'].exportedAt).toBe(1700000000000);
  });

  test('should clear exported records via #btnClearExported, re-select chats, and not toggle #skipExported', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async () => {
      const mockConvs = [
        { id: 'clear_chat_001', title: '已导出会话一', timestamp: 1700000000000 },
        { id: 'clear_chat_002', title: '已导出会话二', timestamp: 1700000000000 }
      ];
      await chrome.storage.local.set({
        gemini_conversations: (mockConvs).map(canonicalIndexFixture),
        exportedIds: {
          'clear_chat_001': { exportedAt: 1700000005000, chatTime: 1700000000000, title: '已导出会话一' },
          'clear_chat_002': { exportedAt: 1700000005000, chatTime: 1700000000000, title: '已导出会话二' }
        },
        has_completed_tour: true,
        last_seen_feature_version: '999.0.0'
      });
      if (typeof (window as any).__workbenchLoadStore === 'function') {
        await (window as any).__workbenchLoadStore(true);
      }
    });

    await expect(page.locator('#list .badge-exported')).toHaveCount(2);
    await expect(page.locator('#list input[type=checkbox]:checked')).toHaveCount(0);
    await expect(page.locator('#skipExported')).toBeChecked();

    // Click #btnClearExported
    await page.click('#btnClearExported');

    // Exported badges must be cleared, all items auto-checked for re-export, and #skipExported unchanged
    await expect(page.locator('#list .badge-exported')).toHaveCount(0);
    await expect(page.locator('#list input[type=checkbox]:checked')).toHaveCount(2);
    await expect(page.locator('#skipExported')).toBeChecked();

    // Verify storage keys (exportedIds) are cleared
    const storageAfter = await page.evaluate(async () => {
      return await chrome.storage.local.get(['exportedIds']);
    }) as Record<string, any>;
    expect(Object.keys(storageAfter.exportedIds || {})).toHaveLength(0);
  });
});



