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
  return formatJsonRecord([
    ['headers', request.headers],
    ['query', request.query],
    ['pathParams', request.pathParams],
    ['body', request.body],
    ['multipart', request.multipart],
  ]);
}

export function formatResponsePreview(response: OpenApiResponsePreview | undefined): string | undefined {
  if (response === undefined) return undefined;
  return formatJsonRecord([
    ['status', response.status],
    ['content-type', response.contentType],
    ['source', response.source],
    ['body', response.body],
  ]);
}

export function formatRunRequest(
  url: string | undefined,
  request: UiRunRequestValue | undefined,
): string | undefined {
  return formatJsonRecord([
    ['url', url],
    ['headers', request?.headers],
    ['body', request?.body],
  ]);
}

export function formatRunResponse(response: UiRunResponseValue | undefined): string | undefined {
  if (response === undefined) return undefined;
  return formatJsonRecord([
    ['status', response.status],
    ['statusText', response.statusText === '' ? undefined : response.statusText],
    ['headers', response.headers],
    ['body', response.body],
  ]);
}

function normalizeJsonBody(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function formatJsonRecord(entries: Array<[string, unknown]>): string | undefined {
  const values = entries
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, key === 'body' ? normalizeJsonBody(value) : value] as const);
  return values.length === 0
    ? undefined
    : JSON.stringify(Object.fromEntries(values), null, 2);
}
