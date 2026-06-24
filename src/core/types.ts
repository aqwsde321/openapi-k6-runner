export interface Scenario {
  name: string;
  description?: string;
  vars?: Record<string, unknown>;
  steps: Step[];
}

export type Step = ApiStep | InputStep;

export interface ApiStep {
  id: string;
  api: ApiReference;
  request?: StepRequest;
  extract?: Record<string, ExtractRule>;
  condition?: string;
}

export interface InputStep {
  id: string;
  input: StepInput;
}

export interface StepInput {
  name: string;
  label?: string;
  required: boolean;
  sensitive?: boolean;
}

export interface ApiReference {
  module?: string;
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
  requestBodyHint?: ApiCatalogRequestBodyHint;
  responseExtractCandidates?: ApiCatalogExtractCandidate[];
}

export interface ApiCatalogRequestBodyHint {
  contentType: string;
  source: 'example' | 'schema';
  example: unknown;
  fields?: ApiCatalogRequestBodyFieldHint[];
}

export interface ApiCatalogRequestBodyFieldHint {
  path: string;
  type?: string;
  required: boolean;
  placeholder?: string;
  env?: string;
}

export interface ApiCatalogExtractCandidate {
  name: string;
  from: string;
  status: string;
  contentType?: string;
}

export interface ASTScenario {
  name: string;
  vars?: Record<string, unknown>;
  steps: ASTStep[];
}

export type ASTStep = ASTApiStep | ASTInputStep;

export interface ASTApiStep {
  id: string;
  moduleName?: string;
  method: string;
  path: string;
  pathParameters: unknown[];
  request: StepRequest;
  extract?: Record<string, ExtractRule>;
  condition?: string;
}

export interface ASTInputStep {
  id: string;
  input: StepInput;
}

export function isApiStep(step: Step): step is ApiStep {
  return 'api' in step;
}

export function isInputStep(step: Step): step is InputStep {
  return 'input' in step;
}

export function isASTApiStep(step: ASTStep): step is ASTApiStep {
  return 'method' in step;
}

export function isASTInputStep(step: ASTStep): step is ASTInputStep {
  return 'input' in step;
}
