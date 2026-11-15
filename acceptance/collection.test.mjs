import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/samples.mjs';
import * as intake from '../src/intake.mjs';
import { Inbox } from '../src/store.mjs';

async function run(scenario, check) {
  assert.equal(typeof intake.collect, 'function', 'collection entry is not available yet');
  const source = await fixture(scenario); const store = new Inbox();
  try {
    const result = await intake.collect(source, store);
    await check(result, source, store);
  } finally { store.close(); await source.close(); }
}

for (const scenario of ['normal', 'compressed', 'unknown-count']) {
  test(scenario + ' retains long-string slots and user missing semantics', async () => {
    await run(scenario, async result => {
      assert.equal(result.status, 'complete'); assert.equal(result.records.length, 2);
      assert.equal(result.variables.length, 2);
      assert.equal(result.variables[0].name, 'respondent_age');
      assert.ok(result.variables[0].valueLabels.some(row => row.value === 99 && row.label === 'refused'));
      assert.equal(result.records[0].values.respondent_age.value, 42);
      assert.equal(result.records[1].values.respondent_age.missing, 'user');
      assert.equal(result.records[0].values.interview_note.value, 'needs visit');
    });
  });
}
test('truncated cases and unsupported compression cannot report complete', async () => {
  await run('truncated', async result => { assert.equal(result.status, 'incomplete'); });
  await run('unsupported', async result => { assert.equal(result.status, 'unsupported'); });
});
