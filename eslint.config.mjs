import {createRequire} from 'node:module';
const require=createRequire(new URL('./edge-cloudflare/package.json',import.meta.url));
const js=require('@eslint/js');
const globals=require('globals');

// Correctness baseline, deliberately independent of existing compact formatting.
export default [
  {ignores:['**/node_modules/**','**/.wrangler/**']},
  {files:['eslint.config.mjs','edge-cloudflare/**/*.mjs','scripts/**/*.mjs','extension/**/*.js','extension/**/*.cjs'],
    ...js.configs.recommended,
    languageOptions:{ecmaVersion:'latest',globals:{...globals.node,...globals.worker,...globals.browser,
      chrome:'readonly',importScripts:'readonly'}},
    rules:{...js.configs.recommended.rules,
      'no-unused-vars':['error',{args:'none',caughtErrors:'none',varsIgnorePattern:'^_'}]}},
  {files:['extension/**/*.js'],languageOptions:{sourceType:'script'}},
  {files:['extension/background.js'],languageOptions:{globals:{
    PhoneTelegram:'readonly',AutoEngine:'readonly',AutoRunner:'readonly'}}},
  // Transport errors intentionally discard causes: they may contain tokens,
  // request URLs or raw upstream responses. Covered by redaction regressions.
  {files:['edge-cloudflare/market-readonly.mjs'],rules:{'preserve-caught-error':'off'}},
];
