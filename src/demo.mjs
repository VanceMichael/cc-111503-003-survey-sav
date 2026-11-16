import { fixture } from './samples.mjs';
import { preview, collect } from './intake.mjs';
import { Inbox } from './store.mjs';

const source = await fixture();
const store = new Inbox();
try {
  const result = await preview(source, store);
  console.log(JSON.stringify({ result, evidence: store.evidence() }, null, 2));
} finally { store.close(); await source.close(); }

for (const scenario of ['normal', 'compressed', 'unknown-count', 'truncated', 'unsupported']) {
  const collected = await fixture(scenario);
  const inbox = new Inbox();
  try {
    const result = await collect(collected, inbox);
    console.log(JSON.stringify({
      scenario,
      status: result.status,
      declaredCases: result.declaredCases,
      delivered: result.records.length,
      pending: result.pending.length,
      variables: result.variables.map(variable => variable.name),
      diagnostics: result.diagnostics,
      receipts: inbox.list('collections'),
    }, null, 2));
  } finally { inbox.close(); await collected.close(); }
}
