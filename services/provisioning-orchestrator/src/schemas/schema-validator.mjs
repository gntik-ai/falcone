/**
 * Lightweight JSON Schema draft-2020-12 subset validator.
 *
 * Supports: type, required, properties, additionalProperties, $ref (local $defs),
 * enum, pattern, minLength, minimum, format (date-time), items, oneOf array types.
 *
 * Does NOT replace a full Ajv-class validator — covers the subset used by
 * the v1.0.0 config export schema and is sufficient for the initial release.
 *
 * @module schemas/schema-validator
 */

/**
 * @typedef {{ path: string, message: string }} ValidationError
 * @typedef {{ path: string, message: string }} ValidationWarning
 * @typedef {{ valid: boolean, errors: ValidationError[], warnings: ValidationWarning[] }} ValidationResult
 */

/**
 * Validate a value against a JSON Schema (subset).
 *
 * @param {unknown} data - The value to validate.
 * @param {object} schema - The JSON Schema object (with $defs at root).
 * @returns {ValidationResult}
 */
export function validate(data, schema) {
  const errors = [];
  const warnings = [];
  const defs = schema.$defs ?? schema.definitions ?? {};

  _validate(data, schema, '', defs, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// --- Internal helpers ---

function resolveRef(ref, defs) {
  // Only handles local $defs refs: "#/$defs/Name"
  const match = ref.match(/^#\/\$defs\/(.+)$/);
  if (!match) return null;
  return defs[match[1]] ?? null;
}

function typeOf(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'number' && Number.isInteger(val)) return 'integer';
  return typeof val;
}

function matchesType(val, type) {
  if (Array.isArray(type)) {
    return type.some(t => matchesType(val, t));
  }
  const actual = typeOf(val);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function _validate(data, schema, path, defs, errors, warnings) {
  if (!schema || typeof schema !== 'object') return;

  // Resolve $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, defs);
    if (!resolved) {
      errors.push({ path, message: `Unresolvable $ref: ${schema.$ref}` });
      return;
    }
    _validate(data, resolved, path, defs, errors, warnings);
    return;
  }

  // type
  if (schema.type !== undefined) {
    if (!matchesType(data, schema.type)) {
      errors.push({ path: path || '/', message: `Expected type ${JSON.stringify(schema.type)}, got ${typeOf(data)}` });
      return; // no point checking further
    }
  }

  // enum
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(data)) {
      errors.push({ path: path || '/', message: `Value ${JSON.stringify(data)} not in enum [${schema.enum.join(', ')}]` });
    }
  }

  // pattern
  if (schema.pattern !== undefined && typeof data === 'string') {
    if (!new RegExp(schema.pattern).test(data)) {
      errors.push({ path: path || '/', message: `String does not match pattern ${schema.pattern}` });
    }
  }

  // minLength
  if (schema.minLength !== undefined && typeof data === 'string') {
    if (data.length < schema.minLength) {
      errors.push({ path: path || '/', message: `String length ${data.length} < minLength ${schema.minLength}` });
    }
  }

  // minimum
  if (schema.minimum !== undefined && typeof data === 'number') {
    if (data < schema.minimum) {
      errors.push({ path: path || '/', message: `Value ${data} < minimum ${schema.minimum}` });
    }
  }

  // format: date-time (basic check)
  if (schema.format === 'date-time' && typeof data === 'string') {
    if (Number.isNaN(Date.parse(data))) {
      errors.push({ path: path || '/', message: `Invalid date-time format: ${data}` });
    }
  }

  // object
  if (schema.type === 'object' || (typeof data === 'object' && data !== null && !Array.isArray(data) && schema.properties)) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;

    // required
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) {
          errors.push({ path: `${path}/${key}`, message: `Missing required property: ${key}` });
        }
      }
    }

    // properties
    const knownKeys = new Set(Object.keys(schema.properties ?? {}));

    for (const [key, val] of Object.entries(data)) {
      const propSchema = schema.properties?.[key];
      if (propSchema) {
        _validate(val, propSchema, `${path}/${key}`, defs, errors, warnings);
      } else if (!knownKeys.has(key)) {
        // additionalProperties: true means allow but warn
        if (schema.additionalProperties === true || schema.additionalProperties === undefined) {
          // Only warn on non-underscore prefixed keys to reduce noise on internal metadata
          if (!key.startsWith('_')) {
            warnings.push({ path: `${path}/${key}`, message: `Unknown additional property: ${key}` });
          }
        } else if (schema.additionalProperties === false) {
          errors.push({ path: `${path}/${key}`, message: `Additional property not allowed: ${key}` });
        }
      }
    }
  }

  // array + items
  if ((schema.type === 'array' || Array.isArray(data)) && Array.isArray(data) && schema.items) {
    for (let i = 0; i < data.length; i++) {
      _validate(data[i], schema.items, `${path}/${i}`, defs, errors, warnings);
    }
  }
}
