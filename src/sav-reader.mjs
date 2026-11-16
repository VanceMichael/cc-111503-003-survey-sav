import { header } from './sav-header.mjs';

// 系统缺失在物理记录中的表示：可表示的最负 double（0xFFEFFFFFFFFFFFFF）。
const SYSMIS = -Number.MAX_VALUE;

const RECORD_VARIABLE = 2;
const RECORD_VALUE_LABELS = 3;
const RECORD_LABEL_VARIABLES = 4;
const RECORD_EXTENSION = 7;
const RECORD_END = 999;

const EXTENSION_LONG_NAMES = 13;
const EXTENSION_ENCODING = 20;

// 字典中途结束：来源尚未传完，属于“尚不完整”。
class Truncated extends Error {
  constructor(part, offset) {
    super(`truncated ${part} at offset ${offset}`);
    this.name = 'Truncated';
    this.part = part;
    this.offset = offset;
  }
}

// 格式本身超出接收范围：属于“格式不支持”，不按猜测接收。
class Unsupported extends Error {
  constructor(what, offset = null) {
    super(offset == null ? `unsupported ${what}` : `unsupported ${what} at offset ${offset}`);
    this.name = 'Unsupported';
    this.offset = offset;
  }
}

function parseDictionary(bytes, diagnostics) {
  const records = [];
  const labelSets = new Map();
  const longNames = new Map();
  let encoding = null;
  let pendingLabels = null;
  let offset = 176;
  let dataOffset = -1;

  const need = (length, part) => {
    if (offset + length > bytes.length) throw new Truncated(part, offset);
  };

  while (dataOffset < 0) {
    need(4, 'dictionary record');
    const type = bytes.readInt32LE(offset);
    if (type === RECORD_END) {
      need(8, 'dictionary terminator');
      dataOffset = offset + 8;
      continue;
    }
    if (type === RECORD_VARIABLE) {
      need(32, 'variable record');
      const recordOffset = offset;
      const variableType = bytes.readInt32LE(offset + 4);
      const hasLabel = bytes.readInt32LE(offset + 8) !== 0;
      const missingCount = bytes.readInt32LE(offset + 12);
      const shortName = bytes.subarray(offset + 24, offset + 32).toString('ascii').replace(/[\0 ]+$/u, '');
      offset += 32;
      let label = null;
      if (hasLabel) {
        need(4, 'variable label length');
        const length = bytes.readInt32LE(offset);
        if (length < 0) throw new Unsupported(`variable label length ${length}`, offset);
        offset += 4;
        const padded = Math.ceil(length / 4) * 4;
        need(padded, 'variable label');
        label = bytes.subarray(offset, offset + length);
        offset += padded;
      }
      let missingSlots;
      let missingRange = false;
      if (missingCount === 0) missingSlots = 0;
      else if (missingCount >= 1 && missingCount <= 3) missingSlots = missingCount;
      else if (missingCount === -2) { missingSlots = 2; missingRange = true; }
      else if (missingCount === -3) { missingSlots = 3; missingRange = true; }
      else throw new Unsupported(`missing value count ${missingCount}`, recordOffset);
      const missingRaw = [];
      for (let i = 0; i < missingSlots; i += 1) {
        need(8, 'missing value');
        missingRaw.push(bytes.subarray(offset, offset + 8));
        offset += 8;
      }
      records.push({ offset: recordOffset, variableType, shortName, label, missingRaw, missingRange });
      continue;
    }
    if (type === RECORD_VALUE_LABELS) {
      need(8, 'value label record');
      const count = bytes.readInt32LE(offset + 4);
      if (count < 0) throw new Unsupported(`value label count ${count}`, offset);
      offset += 8;
      if (pendingLabels) {
        diagnostics.push({ code: 'labels-without-variables', message: 'value label record was never bound to variables', offset });
      }
      const labels = [];
      for (let i = 0; i < count; i += 1) {
        need(9, 'value label entry');
        const valueRaw = bytes.subarray(offset, offset + 8);
        const length = bytes[offset + 8];
        const padded = Math.ceil((length + 1) / 8) * 8;
        need(8 + padded, 'value label entry');
        labels.push({ valueRaw, text: bytes.subarray(offset + 9, offset + 9 + length) });
        offset += 8 + padded;
      }
      pendingLabels = labels;
      continue;
    }
    if (type === RECORD_LABEL_VARIABLES) {
      need(8, 'value label variables record');
      const count = bytes.readInt32LE(offset + 4);
      if (count < 0) throw new Unsupported(`value label variable count ${count}`, offset);
      offset += 8;
      need(count * 4, 'value label variables record');
      const indices = [];
      for (let i = 0; i < count; i += 1) {
        indices.push(bytes.readInt32LE(offset));
        offset += 4;
      }
      if (!pendingLabels) {
        diagnostics.push({ code: 'label-variables-without-labels', message: 'value label variables record without preceding labels', offset });
      } else {
        // 同一份标签可以指向多个变量，但类型3记录只消费一次。
        for (const index of indices) {
          if (index < 1 || index > records.length) throw new Unsupported(`value label variable index ${index}`, offset);
          labelSets.set(index, pendingLabels);
        }
        pendingLabels = null;
      }
      continue;
    }
    if (type === RECORD_EXTENSION) {
      need(16, 'extension record');
      const subtype = bytes.readInt32LE(offset + 4);
      const size = bytes.readInt32LE(offset + 8);
      const count = bytes.readInt32LE(offset + 12);
      if (size < 0 || count < 0) throw new Unsupported(`extension record geometry ${size}x${count}`, offset);
      offset += 16;
      need(size * count, 'extension record data');
      const data = bytes.subarray(offset, offset + size * count);
      offset += size * count;
      if (subtype === EXTENSION_LONG_NAMES) {
        for (const pair of data.toString('ascii').split('\t')) {
          if (!pair) continue;
          const eq = pair.indexOf('=');
          if (eq < 1) {
            diagnostics.push({ code: 'long-name-entry', message: `unparseable long name entry ${JSON.stringify(pair)}` });
            continue;
          }
          longNames.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
      } else if (subtype === EXTENSION_ENCODING) {
        encoding = data.toString('ascii').trim();
      }
      // 其余扩展子类型按格式设计属于可跳过信息，不影响接收语义。
      continue;
    }
    throw new Unsupported(`dictionary record type ${type}`, offset);
  }
  if (pendingLabels) {
    diagnostics.push({ code: 'labels-without-variables', message: 'value labels were never bound to variables', offset });
  }
  return { records, labelSets, longNames, encoding, dataOffset };
}

// 不认识的编码不能猜着收：只接受明确声明的 UTF-8。
function makeDictionaryDecoder(encoding) {
  if (encoding == null || encoding === '') throw new Unsupported('character encoding is not declared');
  if (!/^utf-?8$/iu.test(encoding)) throw new Unsupported(`character encoding ${JSON.stringify(encoding)}`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return (bytes) => {
    try {
      return decoder.decode(bytes);
    } catch {
      throw new Unsupported('invalid UTF-8 text in dictionary');
    }
  };
}

function decodeMissing(record, variableType, decodeText) {
  if (record.missingRaw.length === 0) return { values: [], range: null };
  if (variableType !== 0) {
    if (record.missingRange) throw new Unsupported('missing value range on a string variable', record.offset);
    return { values: record.missingRaw.map(raw => decodeText(raw).replace(/[\0 ]+$/u, '')), range: null };
  }
  const numbers = record.missingRaw.map(raw => raw.readDoubleLE(0));
  if (record.missingRange) return { values: numbers.slice(2), range: { low: numbers[0], high: numbers[1] } };
  return { values: numbers, range: null };
}

function decodeLabels(labels, kind, decodeText) {
  if (!labels) return [];
  return labels.map(entry => ({
    value: kind === 'numeric' ? entry.valueRaw.readDoubleLE(0) : decodeText(entry.valueRaw).replace(/[\0 ]+$/u, ''),
    label: decodeText(entry.text),
  }));
}

function buildVariables(dictionary, decodeText, diagnostics) {
  const variables = [];
  let slot = 0;
  for (let i = 0; i < dictionary.records.length; i += 1) {
    const record = dictionary.records[i];
    const physical = i + 1;
    if (record.variableType === -1) {
      // continuation 只扩充前序字符串的物理槽位，不产生新题目。
      const last = variables[variables.length - 1];
      if (!last || last.type !== 'string') {
        throw new Unsupported('string continuation without a preceding string variable', record.offset);
      }
      last.segments += 1;
      last.slots.push(slot);
      slot += 1;
      continue;
    }
    if (record.variableType === 0) {
      variables.push({
        physical, offset: record.offset, shortName: record.shortName,
        label: record.label ? decodeText(record.label) : null,
        type: 'numeric', width: null, segments: 1, slots: [slot],
        missing: decodeMissing(record, 0, decodeText),
        valueLabels: decodeLabels(dictionary.labelSets.get(physical), 'numeric', decodeText),
      });
      slot += 1;
      continue;
    }
    if (record.variableType >= 1 && record.variableType <= 255) {
      variables.push({
        physical, offset: record.offset, shortName: record.shortName,
        label: record.label ? decodeText(record.label) : null,
        type: 'string', width: record.variableType, segments: 1, slots: [slot],
        missing: decodeMissing(record, record.variableType, decodeText),
        valueLabels: decodeLabels(dictionary.labelSets.get(physical), 'string', decodeText),
      });
      slot += 1;
      continue;
    }
    throw new Unsupported(`variable type ${record.variableType}`, record.offset);
  }
  for (const variable of variables) {
    if (variable.type === 'string') {
      const needed = Math.ceil(variable.width / 8);
      if (variable.segments !== needed) {
        throw new Unsupported(
          `string variable ${variable.shortName} width ${variable.width} needs ${needed} segments but dictionary has ${variable.segments}`,
          variable.offset,
        );
      }
    }
  }
  const used = new Set();
  for (const variable of variables) {
    let name = dictionary.longNames.get(variable.shortName) ?? variable.shortName;
    if (!name) name = `VAR${variable.physical}`;
    if (used.has(name)) {
      diagnostics.push({ code: 'duplicate-variable-name', message: `variable name ${name} is not unique`, name });
      name = `${name}#${variable.physical}`;
    }
    used.add(name);
    variable.name = name;
  }
  return { variables, slotsPerCase: slot };
}

function plainSlots(bytes, dataOffset) {
  const slots = [];
  const available = bytes.length - dataOffset;
  const fullSlots = Math.floor(available / 8);
  for (let i = 0; i < fullSlots; i += 1) {
    const offset = dataOffset + i * 8;
    slots.push({ raw: bytes.subarray(offset, offset + 8), offset });
  }
  return { slots, ended: true, cut: null, trailingBytes: available % 8 };
}

// 字节码压缩流：每组8个指令，指令组可以横跨问卷边界，取值按槽位顺序展开。
function compressedSlots(bytes, dataOffset, bias) {
  const slots = [];
  let p = dataOffset;
  let ended = false;
  let cut = null;
  while (!ended && !cut && p < bytes.length) {
    if (p + 8 > bytes.length) { cut = 'control group'; break; }
    const group = p;
    p += 8;
    for (let i = 0; i < 8; i += 1) {
      const code = bytes[group + i];
      if (code === 0) continue;
      if (code === 252) { ended = true; break; }
      if (code === 253) {
        if (p + 8 > bytes.length) { cut = 'literal value'; break; }
        slots.push({ raw: bytes.subarray(p, p + 8), offset: p });
        p += 8;
        continue;
      }
      const raw = Buffer.alloc(8);
      if (code === 254) raw.fill(0x20);
      else if (code === 255) raw.writeDoubleLE(SYSMIS, 0);
      else raw.writeDoubleLE(code - bias, 0);
      slots.push({ raw, offset: group + i });
    }
  }
  return { slots, ended, cut, trailingBytes: ended ? bytes.length - p : 0 };
}

function isUserMissing(missing, value) {
  if (missing.values.includes(value)) return true;
  const range = missing.range;
  return range != null && value >= range.low && value <= range.high;
}

function numericCell(variable, slot) {
  const value = slot.raw.readDoubleLE(0);
  const cell = { offset: slot.offset, raw: slot.raw.toString('hex') };
  if (value === SYSMIS) {
    cell.value = null;
    cell.missing = 'system';
  } else if (!Number.isFinite(value)) {
    cell.value = null;
    cell.missing = 'system';
    cell.note = 'non-finite numeric retained as raw only';
  } else {
    cell.value = value;
    if (isUserMissing(variable.missing, value)) cell.missing = 'user';
  }
  return cell;
}

function stringCell(variable, slots, decodeText) {
  const raw = Buffer.concat(slots.map(slot => slot.raw));
  const value = decodeText(raw).replace(/[\0 ]+$/u, '');
  const cell = { offset: slots[0].offset, raw: raw.toString('hex'), value };
  if (variable.missing.values.includes(value)) cell.missing = 'user';
  return cell;
}

function assembleCases(slots, variables, slotsPerCase, decodeText) {
  const count = Math.floor(slots.length / slotsPerCase);
  const cases = [];
  for (let c = 0; c < count; c += 1) {
    const values = {};
    let cursor = c * slotsPerCase;
    for (const variable of variables) {
      const segment = slots.slice(cursor, cursor + variable.segments);
      cursor += variable.segments;
      values[variable.name] = variable.type === 'numeric'
        ? numericCell(variable, segment[0])
        : stringCell(variable, segment, decodeText);
    }
    cases.push({ index: c, values });
  }
  return { cases, leftoverSlots: slots.length % slotsPerCase };
}

// 解析整份系统文件。返回 status（complete/incomplete/unsupported）、
// 变量元数据、完整解码的问卷以及诊断；不抛出来源数据导致的异常。
export function readSav(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const diagnostics = [];
  const empty = { variables: [], cases: [], partialCase: null };

  let head;
  try {
    head = header(bytes);
  } catch (error) {
    const incomplete = /incomplete/u.test(error.message);
    return {
      status: incomplete ? 'incomplete' : 'unsupported',
      declaredCases: null,
      ...empty,
      diagnostics: [{ code: incomplete ? 'truncated-header' : 'unsupported-header', message: error.message }],
    };
  }
  const declaredCases = head.cases >= 0 ? head.cases : null;
  if (head.compression !== 0 && head.compression !== 1) {
    return {
      status: 'unsupported', declaredCases, ...empty,
      diagnostics: [{
        code: 'unsupported-compression',
        message: `compression code ${head.compression} is not supported`,
        compression: head.compression,
      }],
    };
  }

  let dictionary;
  try {
    dictionary = parseDictionary(bytes, diagnostics);
  } catch (error) {
    if (error instanceof Truncated) {
      return {
        status: 'incomplete', declaredCases, ...empty,
        diagnostics: [...diagnostics, { code: 'truncated-dictionary', message: error.message, part: error.part, offset: error.offset }],
      };
    }
    if (error instanceof Unsupported) {
      return {
        status: 'unsupported', declaredCases, ...empty,
        diagnostics: [...diagnostics, { code: 'unsupported-dictionary', message: error.message, offset: error.offset }],
      };
    }
    throw error;
  }

  let decodeText;
  try {
    decodeText = makeDictionaryDecoder(dictionary.encoding);
  } catch (error) {
    return {
      status: 'unsupported', declaredCases, ...empty,
      diagnostics: [...diagnostics, { code: 'unsupported-encoding', message: error.message }],
    };
  }

  let built;
  try {
    built = buildVariables(dictionary, decodeText, diagnostics);
  } catch (error) {
    if (error instanceof Unsupported) {
      return {
        status: 'unsupported', declaredCases, ...empty,
        diagnostics: [...diagnostics, { code: 'unsupported-dictionary', message: error.message, offset: error.offset }],
      };
    }
    throw error;
  }
  const { variables, slotsPerCase } = built;
  if (slotsPerCase === 0) {
    return {
      status: 'unsupported', declaredCases, ...empty,
      diagnostics: [...diagnostics, { code: 'empty-dictionary', message: 'dictionary declares no variables' }],
    };
  }
  if (slotsPerCase !== head.slots) {
    diagnostics.push({
      code: 'slot-count-mismatch',
      message: `header declares ${head.slots} variable slots but dictionary has ${slotsPerCase}`,
      declared: head.slots, computed: slotsPerCase,
    });
  }

  // 数据区文本：声明 UTF-8 后出现的坏字节属于内容损坏，替换并记录，不当作未知编码。
  const fatal = new TextDecoder('utf-8', { fatal: true });
  const lenient = new TextDecoder('utf-8');
  let invalidTextNoted = false;
  const decodeDataText = (raw) => {
    try {
      return fatal.decode(raw);
    } catch {
      if (!invalidTextNoted) {
        invalidTextNoted = true;
        diagnostics.push({ code: 'invalid-text', message: 'case data contains invalid UTF-8; replacement characters inserted' });
      }
      return lenient.decode(raw);
    }
  };

  const stream = head.compression === 1
    ? compressedSlots(bytes, dictionary.dataOffset, head.bias)
    : plainSlots(bytes, dictionary.dataOffset);
  const { cases, leftoverSlots } = assembleCases(stream.slots, variables, slotsPerCase, decodeDataText);
  const partialCase = leftoverSlots > 0 ? { index: cases.length, slots: leftoverSlots } : null;

  // 行数以实际完整解码的问卷为准，头部声明只用于核对。
  let status = 'complete';
  if (head.compression === 1) {
    if (stream.cut) {
      status = 'incomplete';
      diagnostics.push({ code: 'truncated-data', message: `compressed stream ends inside a ${stream.cut}`, part: stream.cut });
    } else if (!stream.ended) {
      if (declaredCases != null && cases.length >= declaredCases && leftoverSlots === 0) {
        diagnostics.push({ code: 'missing-end-marker', message: 'compressed stream has no end marker but declared cases are complete' });
      } else {
        status = 'incomplete';
        diagnostics.push({ code: 'missing-end-marker', message: 'compressed stream ends without an end marker' });
      }
    } else {
      if (partialCase) {
        diagnostics.push({ code: 'partial-case', message: `case ${partialCase.index} has ${partialCase.slots} of ${slotsPerCase} slots`, ...partialCase });
      }
      if (declaredCases != null && cases.length !== declaredCases) {
        diagnostics.push({ code: 'case-count-mismatch', message: `header declares ${declaredCases} cases but ${cases.length} were decoded`, declared: declaredCases, decoded: cases.length });
      }
      if (stream.trailingBytes > 0) {
        diagnostics.push({ code: 'trailing-data', message: `${stream.trailingBytes} unread bytes after end of data`, bytes: stream.trailingBytes });
      }
    }
  } else if (declaredCases != null) {
    if (cases.length < declaredCases) {
      status = 'incomplete';
      diagnostics.push({ code: 'cases-truncated', message: `header declares ${declaredCases} cases but only ${cases.length} are fully present`, declared: declaredCases, decoded: cases.length });
    } else if (cases.length > declaredCases || leftoverSlots > 0 || stream.trailingBytes > 0) {
      diagnostics.push({
        code: 'trailing-data', message: 'data remains beyond the declared cases',
        declared: declaredCases, decoded: cases.length, leftoverSlots, strayBytes: stream.trailingBytes,
      });
    }
  } else if (leftoverSlots > 0 || stream.trailingBytes > 0) {
    status = 'incomplete';
    diagnostics.push({ code: 'partial-case', message: `case ${cases.length} is cut off`, index: cases.length, slots: leftoverSlots });
  }

  return { status, declaredCases, variables, cases, partialCase, diagnostics };
}
