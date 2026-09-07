// src/core/engine/assetFetcher.js - Backward compatibility shim
// Note: AssetFetcher has been moved to src/content/assetFetcher.js to enforce zero DOM dependencies in core.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AssetFetcher = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    if (typeof require !== 'undefined') {
        try {
            return require('../../content/assetFetcher.js');
        } catch {}
    }
    if (typeof self !== 'undefined' && self.AssetFetcher) return self.AssetFetcher;
    if (typeof globalThis !== 'undefined' && globalThis.AssetFetcher) return globalThis.AssetFetcher;
    return {};
}));
