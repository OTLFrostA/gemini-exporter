/**
 * tests/provider_abstraction.test.ts
 * Comprehensive unit test suite for AIProvider abstraction layer,
 * ProviderRegistry and GeminiProvider.
 */
import test from 'node:test';
import assert from 'node:assert';

import { ProviderRegistryClass } from '../src/core/provider/providerRegistry.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import * as TabService from '../src/core/utils/tabService.js';
