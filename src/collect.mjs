import { readSav } from './sav-reader.mjs';

// 收件入口：保存原始证据，解析系统文件，返回可交付问卷与接收状态。
// records 只放闭合且可靠取得的资料；未确认片段进入 pending，诊断独立返回。
export async function collect(source, store) {
  const evidence = store.saveEvidence('sav-package', { name: source.name }, source.bytes);
  const parsed = readSav(source.bytes);

  // 每条记录带证据引用与样本序号，每个字段另带文件内字节偏移，可定位回原件。
  const deliverable = (entry) => ({
    case: entry.index,
    source: source.name,
    evidence,
    values: entry.values,
  });
  const records = parsed.status === 'complete' ? parsed.cases.map(deliverable) : [];
  const pending = parsed.status === 'incomplete' ? parsed.cases.map(deliverable) : [];

  const result = {
    status: parsed.status,
    source: source.name,
    evidence,
    declaredCases: parsed.declaredCases,
    variables: parsed.variables,
    records,
    pending,
    diagnostics: parsed.diagnostics,
  };

  // 接收记录分清尚不完整、格式不支持、已经可靠取得三类。
  store.put('collections', source.name, {
    source: source.name,
    status: parsed.status,
    evidence,
    declaredCases: parsed.declaredCases,
    decodedCases: parsed.cases.length,
    deliveredCases: records.length,
    diagnostics: parsed.diagnostics.map(diagnostic => diagnostic.code),
    at: new Date().toISOString(),
  });
  return result;
}
