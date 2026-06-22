import { buildAst } from '../compiler/ast.builder.js';
import { generateK6Script } from '../compiler/k6.generator.js';
import type { ASTScenario, Scenario } from '../core/types.js';
import {
  validateScenarioAgainstOpenApi,
  type ScenarioValidationResult,
} from '../validator/scenario.validator.js';
import type { ScenarioOpenApiContext } from './scenario-openapi.js';

export type { ScenarioOpenApiContext } from './scenario-openapi.js';

export interface GeneratedK6ScriptPlan {
  outputPath: string;
  script: string;
  warnings: string[];
}

export interface ValidatedAstPlan {
  ast: ASTScenario;
  validation: ScenarioValidationResult;
}

export function validateAndBuildAst(
  scenario: Scenario,
  openApiContext: ScenarioOpenApiContext,
): ValidatedAstPlan {
  const validation = validateScenarioOpenApi(scenario, openApiContext);
  const ast = buildAst(scenario, openApiContext.registrySource, {
    defaultModuleName: openApiContext.defaultModuleName,
  });

  return { ast, validation };
}

export function validateScenarioOpenApi(
  scenario: Scenario,
  openApiContext: ScenarioOpenApiContext,
): ScenarioValidationResult {
  return validateScenarioAgainstOpenApi(
    scenario,
    openApiContext.registrySource,
    { defaultModuleName: openApiContext.defaultModuleName },
  );
}

export function prepareGeneratedK6Script(options: {
  scenario: Scenario;
  outputPath: string;
  openApiContext: ScenarioOpenApiContext;
  fileRootDir: string;
  validatedAst?: ValidatedAstPlan;
}): GeneratedK6ScriptPlan {
  const validatedAst = options.validatedAst
    ?? validateAndBuildAst(options.scenario, options.openApiContext);
  const script = generateK6Script(validatedAst.ast, {
    baseUrl: options.openApiContext.baseUrl,
    moduleBaseUrls: options.openApiContext.moduleBaseUrls,
    fileRootDir: options.fileRootDir,
    outputPath: options.outputPath,
  });

  return {
    outputPath: options.outputPath,
    script,
    warnings: validatedAst.validation.warnings,
  };
}
