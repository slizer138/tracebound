// Canonical JSON: sorted keys (code-unit order), no whitespace, undefined properties dropped.

function enc(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        // Array.from visits holes (value.map skips them), so [,1] becomes [null,1] like JSON.stringify.
        return '[' + Array.from(value, (v) => (v === undefined ? 'null' : enc(v))).join(',') + ']';
      }
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + enc(value[k])).join(',') + '}';
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === undefined) throw new TypeError('canonicalJson: undefined at top level');
  return enc(value);
}
