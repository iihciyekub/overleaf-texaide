'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRECTORIES = ['src', 'public', 'config', 'build'];
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.md', '.txt', '.xml']);

// These patterns target credential-shaped literals, not storage key names or
// runtime placeholders such as `${apiKey}`.
const SECRET_PATTERNS = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bxai-[A-Za-z0-9_-]{16,}\b/g,
  /(?:apiKey|api_key|secretKey)\s*[:=]\s*['"]([A-Za-z0-9._-]{20,})['"]/gi,
  /Bearer\s+[A-Za-z0-9._-]{20,}/g
];

function isStorageKeyMatch(match) {
  const value = match[1];
  return typeof value === 'string' && /^wos-[\w-]*api-key$/i.test(value);
}

function filesIn(directory) {
  const absoluteDirectory = path.join(ROOT, directory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolutePath);
    }
  };
  visit(absoluteDirectory);
  return files;
}

function findSecrets() {
  const findings = [];
  for (const directory of SCAN_DIRECTORIES) {
    for (const file of filesIn(directory)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        let found = false;
        while ((match = pattern.exec(content))) {
          if (!isStorageKeyMatch(match)) {
            found = true;
            break;
          }
        }
        if (found) {
          findings.push(path.relative(ROOT, file));
          break;
        }
      }
    }
  }
  return [...new Set(findings)];
}

const findings = findSecrets();
if (findings.length) {
  console.error('Refusing to build: credential-shaped values were found in:');
  findings.forEach(file => console.error(`- ${file}`));
  console.error('Remove the credential from source or build inputs. API keys must be entered at runtime.');
  process.exitCode = 1;
} else {
  console.log('Secret scan passed: no credential-shaped literals found in source or build output.');
}

module.exports = { findSecrets };
