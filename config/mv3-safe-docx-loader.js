'use strict';

module.exports = source => {
  const dynamicConstructor = ['new', 'Function'].join(' ');
  const unsafeSetImmediate = `"function" != typeof e && (e = ${dynamicConstructor}("" + e));`;
  if (!source.includes(unsafeSetImmediate)) {
    throw new Error('The docx setImmediate compatibility branch changed; review it before building the MV3 extension.');
  }
  return source.replace(
    unsafeSetImmediate,
    '"function" != typeof e && (() => { throw new TypeError("setImmediate callback must be a function"); })();'
  );
};
