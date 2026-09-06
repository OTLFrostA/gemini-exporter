// src/core/constants.js - Pure constants, no DOM / no chrome APIs
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GeminiConstants = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';
    const ALLOWED_FORMATS = ['markdown', 'json_openai', 'json', 'json_raw'];
    const DEFAULT_FORMAT = 'markdown';
    const DIRECT_WRITE_THRESHOLD = 50;
    const FEEDBACK_URL = 'https://tally.so/r/Y56ZBB';
    const STORAGE_KEYS = {
        FORMAT: 'gemini_export_format',
        ZIP: 'gemini_export_zip',
        DEV_MODE: 'gemini_dev_mode',
        SUPPRESS_DIRECT_WRITE_PROMPT: 'gemini_suppress_direct_write_prompt'
    };
    return { ALLOWED_FORMATS, DEFAULT_FORMAT, DIRECT_WRITE_THRESHOLD, STORAGE_KEYS, FEEDBACK_URL };
}));
