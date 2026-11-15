function integer(value) { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes; }
function number(value) { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return bytes; }
function variable(name, width, missing = []) {
  const bytes = Buffer.alloc(32, 0);
  bytes.writeInt32LE(2); bytes.writeInt32LE(width, 4); bytes.writeInt32LE(missing.length, 12);
  bytes.fill(32, 24, 32); bytes.write(name.slice(0, 8), 24, 'ascii');
  return Buffer.concat([bytes, ...missing.map(number)]);
}

export function makeSav(compressed = false) {
  const bytes = Buffer.alloc(176, 32);
  bytes.write('$FL2', 0, 'ascii'); bytes.write('local survey exporter', 4, 'ascii');
  bytes.writeInt32LE(2, 64); bytes.writeInt32LE(3, 68); bytes.writeInt32LE(compressed ? 1 : 0, 72);
  bytes.writeInt32LE(0, 76); bytes.writeInt32LE(2, 80); bytes.writeDoubleLE(100, 84);
  const extension = Buffer.from('AGE=respondent_age\tNOTE=interview_note', 'ascii');
  const encoding = Buffer.from('UTF-8');
  const label = value => {
    const text = Buffer.from(value); const bytes = Buffer.alloc(Math.ceil((text.length + 1) / 8) * 8, 32);
    bytes[0] = text.length; text.copy(bytes, 1); return bytes;
  };
  const labels = Buffer.concat([integer(3), integer(2), number(42), label('adult'), number(99), label('refused'), integer(4), integer(1), integer(1)]);
  const dictionary = Buffer.concat([
    variable('AGE', 0, [99]), variable('NOTE', 12), variable('', -1),
    labels,
    integer(7), integer(13), integer(1), integer(extension.length), extension,
    integer(7), integer(20), integer(1), integer(encoding.length), encoding,
    integer(999), integer(0),
  ]);
  const firstText = Buffer.alloc(16, 32); firstText.write('needs visit');
  const secondText = Buffer.alloc(16, 32); secondText.write('declined');
  const payload = compressed
    ? Buffer.concat([Buffer.from([142, 253, 253, 199, 253, 253, 252, 0]), firstText, secondText])
    : Buffer.concat([number(42), firstText, number(99), secondText]);
  return Buffer.concat([bytes, dictionary, payload]);
}

export async function fixture(scenario = 'normal') {
  let bytes = makeSav(scenario === 'compressed');
  if (scenario === 'unknown-count') { bytes = Buffer.from(bytes); bytes.writeInt32LE(-1, 80); }
  if (scenario === 'truncated') bytes = bytes.subarray(0, bytes.length - 5);
  if (scenario === 'unsupported') { bytes = Buffer.from(bytes); bytes.writeInt32LE(2, 72); }
  return { name: scenario + '.sav', bytes, close: async () => {} };
}
