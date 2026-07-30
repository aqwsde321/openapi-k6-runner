import type { StepRequest } from '../../../core/types.js';
import type { OpenApiResponsePreview } from '../../../openapi/openapi.catalog.js';
import type { UiRunRequestValue, UiRunResponseValue } from '../run-state.js';
import type { UiScenarioDetail } from '../scenarios.js';

type TargetDetail = Pick<UiScenarioDetail, 'targetModules'> & {
  steps: Array<Pick<UiScenarioDetail['steps'][number], 'input' | 'module' | 'targetModule'>>;
};

export function resolveScenarioTargetNames(
  detail: TargetDetail | undefined,
  itemModules: string[] | undefined,
  defaultModule: string | undefined,
): string[] {
  if (detail === undefined) {
    return [...new Set(itemModules?.length ? itemModules : defaultModule === undefined ? [] : [defaultModule])];
  }

  const apiSteps = detail.steps.filter((step) => step.input === undefined);

  if (apiSteps.length === 0) return [];

  const names = detail.targetModules?.length
    ? detail.targetModules
    : apiSteps.map((step) => step.targetModule ?? step.module ?? defaultModule)
      .filter((name): name is string => name !== undefined);

  return [...new Set(names)];
}

export function formatRequestPreview(request: StepRequest | undefined): string | undefined {
  if (request === undefined) return undefined;
  const sections = [
    formatPreviewSection('headers', request.headers),
    formatPreviewSection('query', request.query),
    formatPreviewSection('pathParams', request.pathParams),
    formatPreviewSection('body', request.body),
    formatPreviewSection('multipart', request.multipart),
  ].filter((value): value is string => value !== undefined);
  return sections.length === 0 ? undefined : sections.join('\n\n');
}

export function formatResponsePreview(response: OpenApiResponsePreview | undefined): string | undefined {
  if (response === undefined) return undefined;
  const metadata = [
    `status: ${response.status}`,
    response.contentType === undefined ? undefined : `content-type: ${response.contentType}`,
    response.source === undefined ? undefined : `source: ${response.source}`,
  ].filter((value): value is string => value !== undefined);
  const body = formatPreviewSection('body', response.body);
  return [...metadata, body].filter((value): value is string => value !== undefined).join('\n\n');
}

export function formatRunRequest(
  url: string | undefined,
  request: UiRunRequestValue | undefined,
): string | undefined {
  const sections = [
    url === undefined ? undefined : `url: ${url}`,
    formatPreviewSection('headers', request?.headers),
    formatPreviewSection('body', request?.body),
  ].filter((value): value is string => value !== undefined);
  return sections.length === 0 ? undefined : sections.join('\n\n');
}

export function formatRunResponse(response: UiRunResponseValue | undefined): string | undefined {
  if (response === undefined) return undefined;
  const statusText = response.statusText === '' ? '' : ` ${response.statusText}`;
  return [
    `status: ${response.status}${statusText}`,
    formatPreviewSection('headers', response.headers),
    formatPreviewSection('body', response.body),
  ].filter((value): value is string => value !== undefined).join('\n\n');
}

function formatPreviewSection(label: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return `${label}:\n${formatPreviewValue(value)}`;
}

function formatPreviewValue(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  return JSON.stringify(value, null, 2) ?? String(value);
}
