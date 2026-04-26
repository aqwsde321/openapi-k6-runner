const TEMPLATE_PATTERN = /{{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*}}/g;
const FULL_TEMPLATE_PATTERN = /^{{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*}}$/;

export class TemplateCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateCompileError';
  }
}

export function compileValueExpression(value: unknown): string {
  if (typeof value === 'string') {
    return compileStringExpression(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return JSON.stringify(value);
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => compileValueExpression(item)).join(', ')}]`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${compileValueExpression(item)}`,
    );
    return `{ ${entries.join(', ')} }`;
  }

  throw new TemplateCompileError(`Unsupported template value: ${String(value)}`);
}

function compileStringExpression(value: string): string {
  const fullTemplate = FULL_TEMPLATE_PATTERN.exec(value);

  if (fullTemplate) {
    return `context.${fullTemplate[1]}`;
  }

  if (!value.includes('{{')) {
    return JSON.stringify(value);
  }

  TEMPLATE_PATTERN.lastIndex = 0;

  let cursor = 0;
  let expression = '`';
  let match: RegExpExecArray | null;

  while ((match = TEMPLATE_PATTERN.exec(value)) !== null) {
    expression += compileLiteralTemplatePart(value, value.slice(cursor, match.index));
    expression += `\${context.${match[1]}}`;
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) {
    throw new TemplateCompileError(`Invalid template string: ${value}`);
  }

  expression += compileLiteralTemplatePart(value, value.slice(cursor));
  expression += '`';
  return expression;
}

function compileLiteralTemplatePart(source: string, value: string): string {
  if (value.includes('{{') || value.includes('}}')) {
    throw new TemplateCompileError(`Invalid template string: ${source}`);
  }

  return escapeTemplateLiteral(value);
}

function escapeTemplateLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
