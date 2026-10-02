const browser = Object.fromEntries(['window','document','navigator','localStorage','location','console','setTimeout','clearTimeout',
  'setInterval','clearInterval','requestAnimationFrame','getComputedStyle','ResizeObserver','AbortController','DOMException','Event',
  'EventTarget','DataView','URLSearchParams','caches','alert','URL','fetch'].map(g => [g, 'readonly']));
const node = Object.fromEntries(['process','console','setTimeout','clearTimeout','URL'].map(g => [g, 'readonly']));
const rules = { 'no-undef': 'error', 'no-unused-vars': ['error', { caughtErrors: 'none' }], 'prefer-const': 'error', 'no-var': 'error', eqeqeq: ['error', 'smart'] };

export default [
  { ignores: ['node_modules/**', '_site/**'] },
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser }, rules },
  { files: ['sw.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', AbortController: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } }, rules },
  { files: ['tests/e2e/mock-bluetooth.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script',
    globals: { ...browser, chunks: 'readonly', jbdHwInfo: 'readonly', jbdCells: 'readonly', jk02: 'readonly' } }, rules },
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node, ...browser } }, rules },
];
