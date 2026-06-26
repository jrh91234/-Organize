const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptTagPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const requiredReactImports = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
let match;
const failures = [];
let importMap = null;

while ((match = scriptTagPattern.exec(html)) !== null) {
  const attrs = match[1];
  const body = match[2];
  const isBabelScript = /\btype\s*=\s*(["'])text\/babel\1/i.test(attrs);
  const isImportMap = /\btype\s*=\s*(["'])importmap\1/i.test(attrs);

  if (isImportMap && importMap === null) {
    try {
      importMap = JSON.parse(body);
    } catch (error) {
      const line = html.slice(0, match.index).split('\n').length;
      failures.push(`index.html:${line} import map must be valid JSON: ${error.message}`);
    }
  }

  if (!isBabelScript) continue;

  const hasModuleDataType = /\bdata-type\s*=\s*(["'])module\1/i.test(attrs);
  if (!hasModuleDataType) {
    const line = html.slice(0, match.index).split('\n').length;
    failures.push(`index.html:${line} inline text/babel script must include data-type="module"`);
  }
}

const imports = importMap && importMap.imports;
for (const specifier of requiredReactImports) {
  if (!imports || typeof imports[specifier] !== 'string' || imports[specifier].length === 0) {
    failures.push(`index.html import map must define "${specifier}" so Babel module output can resolve React JSX runtime imports`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Inline Babel module scripts and React import map are configured.');
