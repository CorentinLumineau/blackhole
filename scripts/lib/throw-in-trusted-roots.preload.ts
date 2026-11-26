// Test preload: makes `os.homedir()` throw only while `trustedWriteRoots` is on the call stack, so a
// spawned hook fails inside its lazy root resolution and nowhere else.
const os = require('os');
const real = os.homedir;
os.homedir = (...args: unknown[]) => {
  if (new Error().stack?.includes('trustedWriteRoots')) throw new Error('forced trustedWriteRoots failure');
  return real(...args);
};
