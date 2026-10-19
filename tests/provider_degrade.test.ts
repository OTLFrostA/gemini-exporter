/**
 * tests/provider_degrade.test.ts
 * PR1 subtraction 后保留的真实 provider 测试：
 * - manifest content_scripts 无 ChatGPT 域名匹配
 * - 三处 resolveProvider 收口到 src/core/provider/providerResolver.ts
 */
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveProvider } from '../src/core/provider/providerResolver.js';
