export function header(bytes) {
  if (bytes.length < 176) throw new Error('incomplete SAV header');
  const signature = bytes.subarray(0, 4).toString('ascii');
  if (signature !== '$FL2') throw new Error('unsupported SAV signature');
  if (bytes.readInt32LE(64) !== 2) throw new Error('unsupported SAV layout');
  const compression = bytes.readInt32LE(72);
  return { signature, compression, slots: bytes.readInt32LE(68), cases: bytes.readInt32LE(80),
    bias: bytes.readDoubleLE(84), label: bytes.subarray(109, 173).toString('ascii').trimEnd() };
}
