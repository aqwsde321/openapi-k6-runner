const CONTEXT_REFERENCE = '[A-Za-z_$][A-Za-z0-9_$]*';
const ENV_REFERENCE = 'env\\.[A-Z_][A-Z0-9_]*';
const VARS_REFERENCE = 'vars\\.[A-Za-z_$][A-Za-z0-9_$]*';
const K6_REFERENCE = 'k6\\.(?:run\\.id|scenario\\.(?:iterationInInstance|iterationInTest)|vu\\.(?:idInInstance|idInTest|iterationInInstance|iterationInScenario))';
const TEMPLATE_REFERENCE = `(?:${ENV_REFERENCE}|${VARS_REFERENCE}|${K6_REFERENCE}|${CONTEXT_REFERENCE})`;
const TEMPLATE_PATTERN = new RegExp(`{{\\s*(${TEMPLATE_REFERENCE})\\s*}}`, 'g');
const FULL_TEMPLATE_PATTERN = new RegExp(`^{{\\s*(${TEMPLATE_REFERENCE})\\s*}}$`);

export class TemplateCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateCompileError';
  }
}

export interface TemplateReference {
  raw: string;
  type: 'context' | 'env' | 'k6' | 'vars';
  name: string;
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

export function collectTemplateReferences(value: string): TemplateReference[] {
  const fullTemplate = FULL_TEMPLATE_PATTERN.exec(value);

  if (fullTemplate) {
    return [parseTemplateReference(fullTemplate[1])];
  }

  if (!value.includes('{{')) {
    return [];
  }

  TEMPLATE_PATTERN.lastIndex = 0;

  let cursor = 0;
  let match: RegExpExecArray | null;
  const references: TemplateReference[] = [];

  while ((match = TEMPLATE_PATTERN.exec(value)) !== null) {
    validateLiteralTemplatePart(value, value.slice(cursor, match.index));
    references.push(parseTemplateReference(match[1]));
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) {
    throw new TemplateCompileError(`Invalid template string: ${value}`);
  }

  validateLiteralTemplatePart(value, value.slice(cursor));
  return references;
}

function compileStringExpression(value: string): string {
  const fullTemplate = FULL_TEMPLATE_PATTERN.exec(value);

  if (fullTemplate) {
    return compileTemplateReference(fullTemplate[1]);
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
    expression += `\${${compileTemplateReference(match[1])}}`;
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) {
    throw new TemplateCompileError(`Invalid template string: ${value}`);
  }

  expression += compileLiteralTemplatePart(value, value.slice(cursor));
  expression += '`';
  return expression;
}

function compileTemplateReference(reference: string): string {
  if (reference.startsWith('env.')) {
    return `__ENV.${reference.slice('env.'.length)}`;
  }

  if (reference.startsWith('vars.')) {
    return `VARS.${reference.slice('vars.'.length)}`;
  }

  if (reference.startsWith('k6.')) {
    return compileK6Reference(reference);
  }

  return `context.${reference}`;
}

function compileK6Reference(reference: string): string {
  if (reference === 'k6.run.id') {
    return 'openapiK6RunId()';
  }

  if (reference.startsWith('k6.scenario.')) {
    return `exec.scenario.${reference.slice('k6.scenario.'.length)}`;
  }

  return `exec.vu.${reference.slice('k6.vu.'.length)}`;
}

function compileLiteralTemplatePart(source: string, value: string): string {
  validateLiteralTemplatePart(source, value);
  return escapeTemplateLiteral(value);
}

function validateLiteralTemplatePart(source: string, value: string): void {
  if (value.includes('{{') || value.includes('}}')) {
    throw new TemplateCompileError(`Invalid template string: ${source}`);
  }
}

function parseTemplateReference(reference: string): TemplateReference {
  if (reference.startsWith('env.')) {
    return {
      raw: reference,
      type: 'env',
      name: reference.slice('env.'.length),
    };
  }

  if (reference.startsWith('vars.')) {
    return {
      raw: reference,
      type: 'vars',
      name: reference.slice('vars.'.length),
    };
  }

  if (reference.startsWith('k6.')) {
    return {
      raw: reference,
      type: 'k6',
      name: reference.slice('k6.'.length),
    };
  }

  return {
    raw: reference,
    type: 'context',
    name: reference,
  };
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
