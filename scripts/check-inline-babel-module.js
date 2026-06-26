const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptTagPattern = /<script\b([^>]*)>/gi;
let match;
const failures = [];

while ((match = scriptTagPattern.exec(html)) !== null) {
  const attrs = match[1];
  const isBabelScript = /\btype\s*=\s*(["'])text\/babel\1/i.test(attrs);
  if (!isBabelScript) continue;

  const hasModuleDataType = /\bdata-type\s*=\s*(["'])module\1/i.test(attrs);
  if (!hasModuleDataType) {
    const line = html.slice(0, match.index).split('\n').length;
    failures.push(`index.html:${line} inline text/babel script must include data-type="module"`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Inline Babel scripts are configured to execute as modules.');
