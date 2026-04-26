export class JsonPathCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonPathCompileError';
  }
}

export function compileJsonPathSegments(jsonPath: string): Array<string | number> {
  if (!jsonPath.startsWith('$')) {
    throw new JsonPathCompileError(`Unsupported JSONPath "${jsonPath}": path must start with $`);
  }

  const segments: Array<string | number> = [];
  let cursor = 1;

  while (cursor < jsonPath.length) {
    const char = jsonPath[cursor];

    if (char === '.') {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(jsonPath.slice(cursor + 1));

      if (!match) {
        throw new JsonPathCompileError(`Unsupported JSONPath "${jsonPath}"`);
      }

      segments.push(match[0]);
      cursor += match[0].length + 1;
      continue;
    }

    if (char === '[') {
      const match = /^\[(\d+)\]/.exec(jsonPath.slice(cursor));

      if (!match) {
        throw new JsonPathCompileError(`Unsupported JSONPath "${jsonPath}"`);
      }

      segments.push(Number(match[1]));
      cursor += match[0].length;
      continue;
    }

    throw new JsonPathCompileError(`Unsupported JSONPath "${jsonPath}"`);
  }

  if (segments.length === 0) {
    throw new JsonPathCompileError(`Unsupported JSONPath "${jsonPath}": root extraction is not supported`);
  }

  return segments;
}
