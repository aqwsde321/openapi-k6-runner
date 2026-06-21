import fs from 'node:fs/promises';
import { isMap, Pair, parseDocument, Scalar, YAMLMap } from 'yaml';

import type { LoadTestConfig } from './load-test.config.js';

export interface ModuleConfigEntry {
  openapi: string;
  baseUrl?: string;
  snapshot: string;
  catalog: string;
}

export async function writeModuleConfigEntry(
  config: LoadTestConfig,
  moduleName: string,
  moduleConfig: ModuleConfigEntry,
  setDefault: boolean,
): Promise<void> {
  await updateConfigDocument(config.path, (_document, root) => {
    const modules = root.get('modules', true);

    if (!isMap(modules)) {
      throw new Error(`${config.path}: modules must be an object`);
    }

    const moduleNode = createModuleConfigNode(moduleConfig);

    if (modules.has(moduleName)) {
      modules.set(moduleName, moduleNode);
    } else {
      modules.add(new Pair(new Scalar(moduleName), moduleNode));
    }

    if (setDefault) {
      root.set('defaultModule', moduleName);
    }
  });
}

export async function writeDefaultModuleConfig(config: LoadTestConfig, moduleName: string): Promise<void> {
  await updateConfigDocument(config.path, (_document, root) => {
    root.set('defaultModule', moduleName);
  });
}

export async function removeModuleConfigEntry(
  config: LoadTestConfig,
  moduleName: string,
  defaultModule: string | undefined,
): Promise<void> {
  await updateConfigDocument(config.path, (_document, root) => {
    const modules = root.get('modules', true);

    if (!isMap(modules)) {
      throw new Error(`${config.path}: modules must be an object`);
    }

    modules.delete(moduleName);

    if (defaultModule === undefined) {
      root.delete('defaultModule');
    } else {
      root.set('defaultModule', defaultModule);
    }
  });
}

export function resolveDefaultAfterModuleRemoval(
  config: LoadTestConfig,
  moduleName: string,
): string | undefined {
  if (config.defaultModule !== moduleName) {
    return config.defaultModule;
  }

  const remainingModules = [...config.modules.keys()].filter((name) => name !== moduleName);
  return remainingModules.length === 1 ? remainingModules[0] : undefined;
}

function createModuleConfigNode(
  moduleConfig: ModuleConfigEntry,
): YAMLMap<Scalar<string>, Scalar<string>> {
  const moduleNode = new YAMLMap<Scalar<string>, Scalar<string>>();

  if (moduleConfig.baseUrl !== undefined) {
    moduleNode.add(createCommentedScalarPair(
      'baseUrl',
      moduleConfig.baseUrl,
      ' module 전용 API base URL입니다.\n 없으면 root baseUrl 또는 OpenAPI servers[0].url을 사용합니다.',
    ));
  }

  moduleNode.add(createCommentedScalarPair(
    'openapi',
    moduleConfig.openapi,
    ' sync가 읽을 OpenAPI URL 또는 파일 경로입니다.\n 예: https://api.example.com/v3/api-docs',
  ));
  moduleNode.add(createCommentedScalarPair(
    'snapshot',
    moduleConfig.snapshot,
    ' sync가 저장하고 generate가 읽을 OpenAPI snapshot 경로입니다.\n 상대 경로는 이 config.yaml 위치 기준입니다.',
  ));
  moduleNode.add(createCommentedScalarPair(
    'catalog',
    moduleConfig.catalog,
    ' scenario 작성자가 endpoint를 고를 때 참고할 catalog 경로입니다.\n generate 입력은 catalog가 아니라 snapshot입니다.',
  ));

  return moduleNode;
}

function createCommentedScalarPair(
  key: string,
  value: string,
  commentBefore: string,
): Pair<Scalar<string>, Scalar<string>> {
  const keyNode = new Scalar(key);

  keyNode.commentBefore = commentBefore;

  return new Pair(keyNode, new Scalar(value));
}

async function updateConfigDocument(
  configPath: string,
  update: (
    document: ReturnType<typeof parseDocument>,
    root: ReturnType<typeof parseConfigDocumentRoot>,
  ) => void,
): Promise<void> {
  const raw = await fs.readFile(configPath, 'utf8');
  const document = parseDocument(raw);
  const root = parseConfigDocumentRoot(configPath, document);

  update(document, root);

  await fs.writeFile(configPath, ensureTrailingNewline(document.toString({ lineWidth: 0 })), 'utf8');
}

function parseConfigDocumentRoot(
  configPath: string,
  document: ReturnType<typeof parseDocument>,
) {
  if (document.errors.length > 0) {
    const message = document.errors[0]?.message ?? 'unknown YAML parse error';
    throw new Error(`${configPath}: failed to parse config: ${message}`);
  }

  const root = document.contents;

  if (!isMap(root)) {
    throw new Error(`${configPath}: config must be an object`);
  }

  return root;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}
