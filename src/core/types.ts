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
  multipart?: MultipartRequest;
}

export interface MultipartRequest {
  fields?: Record<string, unknown>;
  files: Record<string, MultipartFile>;
}

export interface MultipartFile {
  path: string;
  filename?: string;
  contentType?: string;
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

export interface ApiCatalog {
  generatedAt: string;
  source: string;
  operations: ApiCatalogOperation[];
}

export interface ApiCatalogOperation {
  method: string;
  path: string;
  operationId?: string;
  tags: string[];
  summary?: string;
  description?: string;
  parameters: unknown[];
  hasRequestBody: boolean;
  requestBodyContentTypes?: string[];
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
