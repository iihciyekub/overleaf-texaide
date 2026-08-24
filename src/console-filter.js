(function suppressWosStartupLogs() {
  'use strict';

  const originalLog = console.log;
  const suppressedPrefixes = [
    '[Wos Configuration] Loaded static config.',
    '[Wos Translate] Successfully initialized',
    'direction=',
  ];

  console.log = function filteredConsoleLog(...args) {
    const message = typeof args[0] === 'string' ? args[0].trimStart() : '';
    if (suppressedPrefixes.some(prefix => message.startsWith(prefix))) return;
    Reflect.apply(originalLog, this, args);
  };
})();
