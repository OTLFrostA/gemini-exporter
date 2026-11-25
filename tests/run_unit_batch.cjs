'use strict';
const path = require('node:path');

const files = JSON.parse(process.env.GEMINI_UNIT_BATCH || '[]');
for (const file of files) {
    require(path.resolve(file));
}
