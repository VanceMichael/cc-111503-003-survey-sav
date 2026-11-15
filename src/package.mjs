import { header } from './sav-header.mjs';

export async function preview(source, store) {
  const evidence = store.saveEvidence('sav-package', { name: source.name }, source.bytes);
  return { mode: 'header', evidence, header: header(source.bytes), physicalBytes: source.bytes.length };
}
