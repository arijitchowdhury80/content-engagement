import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

test('proactive engage opens in docked mode unless a caller explicitly overrides it', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /n\?\.openMode==="normal"\|\|n\?\.openMode==="maximized"\|\|n\?\.openMode==="docked"\?n\.openMode:"docked"/,
    'public engage() should default proactive greetings to docked mode'
  );
  assert.match(
    bundle,
    /[a-z]\.engage\(\{greeting:i,suggestions:a,openMode:/,
    'public engage() should forward the selected open mode to the internal widget API'
  );
  assert.match(
    bundle,
    /engage:\(\{greeting:b,suggestions:k,openMode:m\}\)=>\{const R=Je\.engage\(b,k\?\?\[\]\);return R&&\(m==="docked"\|\|m==="normal"\|\|m==="maximized"\)&&d\(m\),R&&E\(\),R\}/,
    'internal engage() should apply the requested mode before opening'
  );
});
