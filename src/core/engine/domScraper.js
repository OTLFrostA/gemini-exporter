// src/core/engine/domScraper.js - Backward compatibility shim
// Note: DomScraper has been moved to src/content/domScraper.js to enforce zero DOM dependencies in core.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DomScraper = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    if (typeof require !== 'undefined') {
        try {
            return require('../../content/domScraper.js');
        } catch {}
    }
    if (typeof self !== 'undefined' && self.DomScraper) return self.DomScraper;
    if (typeof globalThis !== 'undefined' && globalThis.DomScraper) return globalThis.DomScraper;
    return {};
}));
