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

export interface ApiOperation {
  operationId?: string;
  method: string;
  path: string;
  serverUrl?: string;
  parameters: unknown[];
  requestBody?: unknown;
  responses?: unknown;
}

export interface ApiRegistry {
  byOperationId: Map<string, ApiOperation>;
  byMethodPath: Map<string, ApiOperation>;
  defaultServerUrl?: string;
}

export interface ASTScenario {
  name: string;
  steps: ASTStep[];
}

export interface ASTStep {
  id: string;
  method: string;
  path: string;
  pathParameters: unknown[];
  request: StepRequest;
  extract?: Record<string, ExtractRule>;
  condition?: string;
}
