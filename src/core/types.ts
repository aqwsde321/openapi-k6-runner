export interface Scenario {
  name: string;
  steps: Step[];
}

export interface Step {
  id: string;
  api: ApiReference;
  request?: StepRequest;
  extract?: Record<string, ExtractRule>;
  condition?: string;
}

export interface ApiReference {
  operationId?: string;
  method?: string;
  path?: string;
}

export interface StepRequest {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  body?: unknown;
}

export interface ExtractRule {
  from: string;
}
