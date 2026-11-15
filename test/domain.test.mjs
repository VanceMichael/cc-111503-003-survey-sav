import test from 'node:test';
import assert from 'node:assert/strict';
import { header } from '../src/sav-header.mjs';
import { fixture, makeSav } from '../src/samples.mjs';
import { preview } from '../src/package.mjs';
import { Inbox } from '../src/store.mjs';

test('header parser distinguishes case count and physical variable slots', () => {
  const result = header(makeSav()); assert.equal(result.slots, 3); assert.equal(result.cases, 2);
});
test('package preview retains the entire binary original', async () => {
  const store = new Inbox(); const source = await fixture('compressed');
  try { assert.equal((await preview(source, store)).header.compression, 1); assert.equal(store.evidence()[0].size, source.bytes.length); }
  finally { store.close(); }
});
test('short headers and wrong endian layout are not guessed', () => {
  assert.throws(() => header(Buffer.alloc(40)), /incomplete/);
  const bytes = makeSav(); bytes.writeInt32BE(2, 64); assert.throws(() => header(bytes), /layout/);
});
