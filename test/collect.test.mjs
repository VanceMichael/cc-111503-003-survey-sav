import test from 'node:test';
import assert from 'node:assert/strict';
import { readSav } from '../src/sav-reader.mjs';
import { collect } from '../src/intake.mjs';
import { fixture } from '../src/samples.mjs';
import { Inbox } from '../src/store.mjs';

function int(value) { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes; }
function dbl(value) { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return bytes; }
function text(text, width = 8) { const bytes = Buffer.alloc(width, 32); bytes.write(text, 'utf8'); return bytes; }

function headerRecord({ slots, cases = -1, compression = 0, bias = 100 } = {}) {
  const bytes = Buffer.alloc(176, 32);
  bytes.write('$FL2', 0, 'ascii');
  bytes.writeInt32LE(2, 64); bytes.writeInt32LE(slots, 68); bytes.writeInt32LE(compression, 72);
  bytes.writeInt32LE(cases, 80); bytes.writeDoubleLE(bias, 84);
  return bytes;
}

function variableRecord(name, type, missing = {}) {
  const values = missing.values ?? [];
  const range = missing.range ?? null;
  let count = values.length;
  if (range) count = values.length > 0 ? -3 : -2;
  const body = Buffer.alloc(32, 0);
  body.writeInt32LE(2, 0); body.writeInt32LE(type, 4); body.writeInt32LE(count, 12);
  body.write(name.slice(0, 8), 24, 'ascii');
  const raw = range
    ? [dbl(range[0]), dbl(range[1]), ...values.map(dbl)]
    : values.map(dbl);
  return Buffer.concat([body, ...raw]);
}

function labelRecords(pairs, variableIndices) {
  const entries = pairs.map(([value, label]) => {
    const labelText = Buffer.from(label, 'utf8');
    const padded = Buffer.alloc(Math.ceil((labelText.length + 1) / 8) * 8, 32);
    padded[0] = labelText.length; labelText.copy(padded, 1);
    return Buffer.concat([dbl(value), padded]);
  });
  return Buffer.concat([
    int(3), int(pairs.length), ...entries,
    int(4), int(variableIndices.length), ...variableIndices.map(int),
  ]);
}

function extension(subtype, body) {
  const data = Buffer.from(body, 'ascii');
  return Buffer.concat([int(7), int(subtype), int(1), int(data.length), data]);
}

function savFile({ variables, slots, labels = [], longNames = '', encoding = 'UTF-8',
  cases = [], declared = undefined, extraDictionary = [], compression = 0, payload = null }) {
  const dictionary = Buffer.concat([
    ...variables, ...labels,
    ...(longNames ? [extension(13, longNames)] : []),
    ...(encoding != null ? [extension(20, encoding)] : []),
    ...extraDictionary,
    int(999), int(0),
  ]);
  // declared 缺省取 cases 槽位对应的行数；显式 null 表示头部声明未知行数(-1)。
  let declaredCases;
  if (declared === undefined) declaredCases = cases.length;
  else if (declared === null) declaredCases = -1;
  else declaredCases = declared;
  return Buffer.concat([
    headerRecord({ slots, cases: declaredCases, compression }),
    dictionary,
    ...(payload ? [payload] : cases),
  ]);
}

test('missing range plus extra discrete value marks user missing without dropping the raw value', () => {
  const bytes = savFile({
    variables: [variableRecord('SCORE', 0, { values: [999], range: [0, 10] })],
    slots: 1,
    cases: [dbl(5), dbl(50), dbl(999)],
  });
  const result = readSav(bytes);
  assert.equal(result.status, 'complete');
  assert.equal(result.cases.length, 3);
  const variable = result.variables[0];
  assert.deepEqual(variable.missing, { values: [999], range: { low: 0, high: 10 } });
  assert.deepEqual(
    result.cases.map(entry => entry.values.SCORE.missing ?? null),
    ['user', null, 'user'],
  );
  assert.equal(result.cases[0].values.SCORE.value, 5);
  assert.equal(result.cases[2].values.SCORE.value, 999);
});

test('compressed control codes decode system missing and blank strings without writing zero', () => {
  const bytes = savFile({
    variables: [variableRecord('NUM', 0), variableRecord('TXT', 8)],
    slots: 2,
    compression: 1,
    declared: 1,
    payload: Buffer.from([255, 254, 252, 0, 0, 0, 0, 0]),
  });
  const result = readSav(bytes);
  assert.equal(result.status, 'complete');
  const values = result.cases[0].values;
  assert.equal(values.NUM.value, null);
  assert.equal(values.NUM.missing, 'system');
  assert.notEqual(values.NUM.value, 0);
  assert.equal(values.TXT.value, '');
});

test('one label set serves several variables and the label record is consumed once', () => {
  const bytes = savFile({
    variables: [variableRecord('A', 0), variableRecord('B', 0)],
    slots: 2,
    labels: [labelRecords([[1, 'yes'], [2, 'no']], [1, 2])],
    declared: 1,
    cases: [dbl(1), dbl(2)],
  });
  const result = readSav(bytes);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.variables[0].valueLabels, [{ value: 1, label: 'yes' }, { value: 2, label: 'no' }]);
  assert.deepEqual(result.variables[1].valueLabels, [{ value: 1, label: 'yes' }, { value: 2, label: 'no' }]);
  assert.equal(result.variables.length, 2);
});

test('long string continuations stay one question and long names replace short names', () => {
  const bytes = savFile({
    variables: [variableRecord('NOTE', 12), variableRecord('', -1)],
    slots: 2,
    longNames: 'NOTE=interview_note',
    cases: [text('follow up soon', 16)],
  });
  const result = readSav(bytes);
  assert.equal(result.status, 'complete');
  assert.equal(result.variables.length, 1);
  assert.equal(result.variables[0].name, 'interview_note');
  assert.equal(result.variables[0].shortName, 'NOTE');
  assert.deepEqual(result.variables[0].slots, [0, 1]);
  assert.equal(result.cases[0].values.interview_note.value, 'follow up soon');
});

test('undeclared or unknown encodings are rejected instead of guessed', () => {
  const base = { variables: [variableRecord('A', 0)], slots: 1, cases: [dbl(1)] };
  assert.equal(readSav(savFile({ ...base, encoding: null })).status, 'unsupported');
  assert.equal(readSav(savFile({ ...base, encoding: 'EBCDIC' })).status, 'unsupported');
  const accepted = readSav(savFile(base));
  assert.equal(accepted.status, 'complete');
});

test('out-of-scope dictionary features are unsupported, never guessed', () => {
  const base = { variables: [variableRecord('A', 0)], slots: 1, cases: [dbl(1)] };
  assert.equal(readSav(savFile({ ...base, variables: [variableRecord('WIDE', 300)], slots: 38 })).status, 'unsupported');
  assert.equal(readSav(savFile({ ...base, variables: [variableRecord('A', 0, { values: [1, 2, 3, 4] })] })).status, 'unsupported');
  assert.equal(readSav(savFile({ ...base, extraDictionary: [int(42), int(0)] })).status, 'unsupported');
  const orphan = readSav(savFile({ ...base, variables: [variableRecord('', -1)] }));
  assert.equal(orphan.status, 'unsupported');
});

test('truncation is reported as incomplete whether it cuts dictionary or data', () => {
  const bytes = savFile({
    variables: [variableRecord('A', 0)],
    slots: 1,
    declared: 2,
    cases: [dbl(1), dbl(2)],
  });
  const cutDictionary = readSav(bytes.subarray(0, 176 + 20));
  assert.equal(cutDictionary.status, 'incomplete');
  const cutData = readSav(bytes.subarray(0, bytes.length - 4));
  assert.equal(cutData.status, 'incomplete');
  assert.equal(cutData.cases.length, 1);
  assert.equal(cutData.declaredCases, 2);
});

test('compressed stream without end marker cannot close an unknown-count file', () => {
  const group = Buffer.from([142, 252, 0, 0, 0, 0, 0, 0]);
  const closed = readSav(savFile({
    variables: [variableRecord('A', 0)], slots: 1, compression: 1, declared: 1, payload: group,
  }));
  assert.equal(closed.status, 'complete');
  const open = readSav(savFile({
    variables: [variableRecord('A', 0)], slots: 1, compression: 1, declared: null,
    payload: Buffer.from([142, 0, 0, 0, 0, 0, 0, 0]),
  }));
  assert.equal(open.status, 'incomplete');
});

test('collect keeps fragments out of records and files a receipt per package', async () => {
  const source = await fixture('truncated');
  const store = new Inbox();
  try {
    const result = await collect(source, store);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.records.length, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(result.variables.length, 2);
    const receipts = store.list('collections');
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].status, 'incomplete');
    assert.equal(receipts[0].decodedCases, 1);
    assert.equal(receipts[0].deliveredCases, 0);
    assert.equal(store.evidence()[0].size, source.bytes.length);
  } finally { store.close(); await source.close(); }
});

test('delivered fields locate back to the evidence file and sample row', async () => {
  const source = await fixture('normal');
  const store = new Inbox();
  try {
    const result = await collect(source, store);
    assert.equal(result.status, 'complete');
    const [first] = result.records;
    assert.equal(first.case, 0);
    assert.equal(first.evidence, result.evidence);
    assert.equal(first.source, source.name);
    const cell = first.values.respondent_age;
    assert.equal(cell.value, 42);
    assert.ok(Number.isInteger(cell.offset) && cell.offset >= 176);
    assert.equal(Buffer.from(cell.raw, 'hex').readDoubleLE(0), 42);
    assert.equal(source.bytes.readDoubleLE(cell.offset), 42);
    const receipts = store.list('collections');
    assert.equal(receipts[0].status, 'complete');
    assert.equal(receipts[0].evidence, result.evidence);
  } finally { store.close(); await source.close(); }
});
