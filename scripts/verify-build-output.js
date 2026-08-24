'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIRECTORY = path.join(ROOT, 'build');
const WEBPACK_ERROR_MARKERS = [
  'Module parse failed:',
  'currently no loaders are configured to process this file'
];

function invalidBundles() {
  if (!fs.existsSync(BUILD_DIRECTORY)) return ['build/'];
  return fs.readdirSync(BUILD_DIRECTORY)
    .filter(file => file.endsWith('.js'))
    .filter(file => {
      const source = fs.readFileSync(path.join(BUILD_DIRECTORY, file), 'utf8');
      return WEBPACK_ERROR_MARKERS.some(marker => source.includes(marker));
    })
    .map(file => `build/${file}`);
}

const invalid = invalidBundles();
if (invalid.length) {
  console.error('Refusing to publish bundles containing webpack module errors:');
  invalid.forEach(file => console.error(`- ${file}`));
  process.exitCode = 1;
} else {
  console.log('Build output check passed: no embedded webpack module errors found.');
}

module.exports = { invalidBundles };
