import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import {
  Collapsible,
  CollapsibleGroup,
} from '@astryxdesign/core/Collapsible';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Item } from '@astryxdesign/core/Item';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import {
  MetadataList,
  MetadataListItem,
} from '@astryxdesign/core/MetadataList';
import { Section } from '@astryxdesign/core/Section';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { githubDark } from '@astryxdesign/core/theme/syntax';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type {
  UiScenarioDetail,
  UiScenarioList,
} from '../scenarios.js';
import type { UiRunStatus, UiRunStepResult, UiRunTestResult } from '../run-state.js';
import type { UiServerCheckResult } from '../server-checks.js';
import {
  saveUiScenarioSource,
  validateUiScenarioSource,
} from './api';
import {
  formatRequestPreview,
  formatResponsePreview,
  formatRunRequest,
  formatRunResponse,
  resolveScenarioTargetNames,
} from './scenario-flow-format';

type ScenarioItem = UiScenarioList['scenarios'][number];
type ScenarioStep = UiScenarioDetail['steps'][number];
type ModuleCheck = UiServerCheckResult['modules'][number];
type YamlDefinition = NonNullable<UiScenarioDetail['definition']>;

type YamlPreview =
  | { kind: 'scenario' }
  | { kind: 'included'; path: string }
  | { kind: 'step'; definition: YamlDefinition };

interface IncludedYamlDefinition extends YamlDefinition {
  source: string;
}

interface YamlEditState {
  code: string;
  isSaving?: boolean;
  revision: string;
  validatedCode?: string;
  status?: { type: 'error' | 'success' | 'warning'; message: string };
}

export interface ScenarioFlowProps {
  defaultModule?: string;
  detail?: UiScenarioDetail;
  error?: string;
  item?: ScenarioItem;
  loading: boolean;
  modules: ModuleCheck[];
  onScenarioSaved: () => Promise<void> | void;
  testResult?: UiRunTestResult;
  testStatus?: 'starting' | UiRunStatus;
}

export function ScenarioFlow({
  defaultModule,
  detail,
  error,
  item,
  loading,
  modules,
  onScenarioSaved,
  testResult,
  testStatus,
}: ScenarioFlowProps) {
  const [yamlPreview, setYamlPreview] = useState<YamlPreview>();
  const [yamlEdit, setYamlEdit] = useState<YamlEditState>();

  if (item === undefined) {
    return (
      <VStack padding={6}>
        <EmptyState
          description="왼쪽 탐색에서 확인할 시나리오를 선택하세요."
          isCompact
          title="선택된 시나리오 없음"
        />
      </VStack>
    );
  }

  const targetNames = resolveScenarioTargetNames(detail, item.modules, defaultModule);
  const scenarioDefinition = detail?.definition;
  const includedDefinitions = collectIncludedYamlDefinitions(detail, scenarioDefinition?.path);
  const previewDefinition = yamlPreview?.kind === 'step'
    ? yamlPreview.definition
    : yamlPreview?.kind === 'included'
      ? includedDefinitions.find((definition) => definition.path === yamlPreview.path) ??
        includedDefinitions[0]
      : scenarioDefinition;
  const closeYamlPreview = () => {
    setYamlPreview(undefined);
    setYamlEdit(undefined);
  };
  const validateYamlEdit = async () => {
    if (detail === undefined || yamlEdit === undefined || yamlEdit.isSaving) return;
    const code = yamlEdit.code;

    try {
      const result = await validateUiScenarioSource(detail.id, code);
      setYamlEdit((current) => current?.code === code
        ? {
            ...current,
            validatedCode: code,
            status: {
              type: result.warnings.length === 0 ? 'success' : 'warning',
              message: `검증 완료 · ${result.stepCount}단계${result.warnings.length === 0
                ? ''
                : ` · 경고 ${result.warnings.length}개`}`,
            },
          }
        : current);
    } catch (error) {
      setYamlEdit((current) => current?.code === code
        ? {
            ...current,
            validatedCode: undefined,
            status: { type: 'error', message: toErrorMessage(error) },
          }
        : current);
    }
  };
  const saveYamlEdit = async () => {
    if (
      detail === undefined ||
      yamlEdit === undefined ||
      yamlEdit.isSaving ||
      yamlEdit.validatedCode !== yamlEdit.code
    ) {
      return;
    }
    const code = yamlEdit.code;
    setYamlEdit((current) => current?.code === code
      ? { ...current, isSaving: true }
      : current);

    try {
      await saveUiScenarioSource(detail.id, code, yamlEdit.revision);
      await onScenarioSaved();
      closeYamlPreview();
    } catch (error) {
      setYamlEdit((current) => current === undefined
        ? current
        : {
            ...current,
            isSaving: false,
            validatedCode: undefined,
            status: { type: 'error', message: toErrorMessage(error) },
          });
    }
  };

  return (
    <VStack gap={0}>
      <Section dividers={['bottom']} padding={5}>
        <VStack gap={4}>
          <VStack gap={2}>
            <HStack gap={2} hAlign="between" vAlign="center">
              <HStack gap={2} vAlign="center">
                <Text color="secondary" type="label">시나리오</Text>
                <Badge label={`${detail?.stepCount ?? item.stepCount ?? 0}단계`} />
              </HStack>
              {scenarioDefinition !== undefined && (
                <Button
                  label="YAML 보기"
                  onClick={() => setYamlPreview({ kind: 'scenario' })}
                  size="sm"
                  variant="ghost"
                />
              )}
            </HStack>
            <Heading level={2} maxLines={2}>{detail?.name ?? item.name}</Heading>
            <Text as="p" color="secondary" type="supporting">
              {detail?.description ?? item.description ?? item.path}
            </Text>
          </VStack>

          <VStack gap={2}>
            <Text type="label" weight="semibold">실행 대상</Text>
            {targetNames.length === 0 ? (
              <Text color="secondary" type="supporting">대상 모듈 정보 없음</Text>
            ) : targetNames.map((name) => (
              <TargetRow
                key={name}
                module={modules.find((candidate) => candidate.name === name)}
                name={name}
              />
            ))}
          </VStack>
        </VStack>
      </Section>

      {item.error !== undefined || error !== undefined ? (
        <Banner
          container="section"
          description={item.error ?? error ?? ''}
          status="error"
          title="시나리오 상세를 불러오지 못했습니다"
        />
      ) : loading || detail === undefined ? (
        <VStack padding={6}>
          <Text color="secondary" type="supporting">시나리오 상세 불러오는 중…</Text>
        </VStack>
      ) : (
        <ScenarioSteps
          defaultModule={defaultModule}
          detail={detail}
          onOpenYaml={(definition) => setYamlPreview({ kind: 'step', definition })}
          testResult={testResult}
          testStatus={testStatus}
        />
      )}
      {yamlPreview !== undefined && previewDefinition !== undefined && (
        <Dialog
          isOpen
          maxHeight="90vh"
          onOpenChange={(isOpen) => {
            if (!isOpen && yamlEdit === undefined) closeYamlPreview();
          }}
          purpose={yamlEdit === undefined ? 'info' : 'required'}
          width={960}
        >
          <Layout
            header={(
              <DialogHeader
                onOpenChange={yamlEdit === undefined
                  ? (isOpen) => {
                      if (!isOpen) closeYamlPreview();
                    }
                  : undefined}
                subtitle={previewDefinition.path}
                title={yamlEdit !== undefined
                  ? '시나리오 YAML 편집'
                  : yamlPreview.kind === 'step' ? '단계 YAML' : '시나리오 YAML'}
                endContent={yamlEdit === undefined && yamlPreview.kind === 'scenario' &&
                  scenarioDefinition?.editable && scenarioDefinition.revision !== undefined
                  ? (
                      <Button
                        label="편집"
                        onClick={() => setYamlEdit({
                          code: scenarioDefinition.code,
                          revision: scenarioDefinition.revision!,
                        })}
                        size="sm"
                        variant="ghost"
                      />
                    )
                  : yamlEdit === undefined
                    ? (
                        <Text color="secondary" type="supporting">
                          {yamlPreview.kind === 'scenario'
                            ? '편집 비활성 · --show-sensitive-values 필요'
                            : '읽기 전용'}
                        </Text>
                      )
                    : undefined}
              />
            )}
            content={(
              <LayoutContent padding={0}>
                <VStack gap={0}>
                  {yamlEdit !== undefined ? (
                    <VStack padding={4}>
                      <TextArea
                        disabledMessage="저장 중입니다."
                        hasAutoFocus
                        hasSpellCheck={false}
                        isDisabled={yamlEdit.isSaving}
                        isLabelHidden
                        label="시나리오 YAML"
                        onChange={(code) => setYamlEdit((current) => current === undefined
                          ? current
                          : {
                              ...current,
                              code,
                              validatedCode: undefined,
                              status: undefined,
                            })}
                        rows={24}
                        size="sm"
                        status={yamlEdit.status}
                        value={yamlEdit.code}
                      />
                    </VStack>
                  ) : (
                    <>
                      {yamlPreview.kind !== 'step' && includedDefinitions.length > 0 && (
                        <TabList
                          aria-label="YAML 범위"
                          hasDivider
                          layout="fill"
                          onChange={(value) => setYamlPreview(value === 'included'
                            ? { kind: 'included', path: includedDefinitions[0]!.path }
                            : { kind: 'scenario' })}
                          size="sm"
                          value={yamlPreview.kind}
                        >
                          <Tab label="현재 YAML" value="scenario" />
                          <Tab
                            endContent={<Badge label={includedDefinitions.length} />}
                            label="포함 YAML"
                            value="included"
                          />
                        </TabList>
                      )}
                      {yamlPreview.kind === 'included' && includedDefinitions.length > 1 && (
                        <Section dividers={['bottom']} padding={0}>
                          <VStack gap={0}>
                            {includedDefinitions.map((definition) => (
                              <Item
                                key={definition.path}
                                density="compact"
                                description={definition.source}
                                isSelected={definition.path === previewDefinition.path}
                                label={(
                                  <Text hasTruncateTooltip maxLines={1} type="code">
                                    {definition.path}
                                  </Text>
                                )}
                                onClick={() => setYamlPreview({
                                  kind: 'included',
                                  path: definition.path,
                                })}
                              />
                            ))}
                          </VStack>
                        </Section>
                      )}
                      <CodeBlock
                        code={previewDefinition.code}
                        container="section"
                        hasLineNumbers
                        highlightLines={findScenarioReferenceLines(previewDefinition.code)}
                        isWrapped
                        language={previewDefinition.path.toLowerCase().endsWith('.json')
                          ? 'json'
                          : 'yaml'}
                        maxHeight="70vh"
                        size="sm"
                        width="100%"
                      />
                    </>
                  )}
                </VStack>
              </LayoutContent>
            )}
            footer={yamlEdit === undefined ? undefined : (
              <LayoutFooter hasDivider>
                <HStack gap={2} hAlign="end" padding={3}>
                  <Button
                    isDisabled={yamlEdit.isSaving}
                    label="취소"
                    onClick={() => setYamlEdit(undefined)}
                    size="sm"
                    variant="ghost"
                  />
                  <Button
                    clickAction={validateYamlEdit}
                    isDisabled={yamlEdit.isSaving}
                    label="검증"
                    size="sm"
                    variant="secondary"
                  />
                  <Button
                    clickAction={saveYamlEdit}
                    isDisabled={yamlEdit.isSaving || yamlEdit.validatedCode !== yamlEdit.code}
                    label="저장"
                    size="sm"
                    variant="primary"
                  />
                </HStack>
              </LayoutFooter>
            )}
          />
        </Dialog>
      )}
    </VStack>
  );
}

function ScenarioSteps({
  defaultModule,
  detail,
  onOpenYaml,
  testResult,
  testStatus,
}: {
  defaultModule?: string;
  detail: UiScenarioDetail;
  onOpenYaml: (definition: YamlDefinition) => void;
  testResult?: UiRunTestResult;
  testStatus?: 'starting' | UiRunStatus;
}) {
  if (detail.steps.length === 0) {
    return (
      <VStack padding={6}>
        <EmptyState
          description="시나리오 YAML에 실행 단계가 없습니다."
          isCompact
          title="실행할 endpoint 없음"
        />
      </VStack>
    );
  }

  const unresolved = detail.steps.some((step) => (
    step.input === undefined && (step.method === undefined || step.path === undefined)
  ));
  const targetModules = resolveScenarioTargetNames(detail, detail.modules, defaultModule);
  const showTargetModule = targetModules.length > 1;
  const sourceLabels = detail.steps.map(formatStepSource);

  return (
    <Section padding={0}>
      <Section dividers={['bottom']} padding={4} paddingBlock={3}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <Heading level={3}>실행 예정 endpoint</Heading>
          <HStack gap={2} vAlign="center">
            {testStatus !== undefined && <RunStatus status={testStatus} />}
            <Badge label={detail.steps.length} />
          </HStack>
        </HStack>
      </Section>
      {unresolved && (
        <Section dividers={['bottom']} padding={4}>
          <Text color="secondary" type="supporting">
            OpenAPI에서 일부 endpoint를 해석하지 못해 YAML 기준 정보만 표시합니다.
          </Text>
        </Section>
      )}
      <CollapsibleGroup key={detail.id} density="compact" hasDividers type="multiple">
        {detail.steps.map((step, index) => (
          <Collapsible
            key={`${index}:${step.id}`}
            trigger={(
              <StepRow
                defaultModule={defaultModule}
                index={index}
                result={testResult?.steps.find((candidate) => candidate.index === index)}
                step={step}
                showSource={sourceLabels[index] !== undefined && sourceLabels[index] !== sourceLabels[index - 1]}
                showTargetModule={showTargetModule}
                testFinished={testStatus === 'passed' || testStatus === 'failed'}
              />
            )}
            value={String(index)}
          >
            <StepDetail
              onOpenYaml={onOpenYaml}
              result={testResult?.steps.find((candidate) => candidate.index === index)}
              step={step}
            />
          </Collapsible>
        ))}
      </CollapsibleGroup>
    </Section>
  );
}

function StepRow({
  defaultModule,
  index,
  result,
  step,
  showSource,
  showTargetModule,
  testFinished,
}: {
  defaultModule?: string;
  index: number;
  result?: UiRunStepResult;
  step: ScenarioStep;
  showSource: boolean;
  showTargetModule: boolean;
  testFinished: boolean;
}) {
  const targetModule = step.input === undefined
    ? step.targetModule ?? step.module ?? defaultModule
    : undefined;
  const source = formatStepSource(step);

  return (
    <Item
      align="start"
      as="span"
      density="compact"
      description={(
        <HStack as="span" gap={2} vAlign="center" wrap="wrap">
          <Text color="secondary" type="supporting">{step.id}</Text>
          {showTargetModule && targetModule !== undefined && (
            <Text color="secondary" type="supporting">{targetModule}</Text>
          )}
          {showSource && source !== undefined && (
            <Badge label={source} variant="teal" />
          )}
        </HStack>
      )}
      label={(
        <HStack as="span" gap={2} vAlign="center" wrap="wrap">
          <Text type="code" weight="semibold">
            {formatStepPath(step)}
          </Text>
          {step.openApi?.summary !== undefined && (
            <Text color="secondary" hasTruncateTooltip maxLines={1} type="supporting">
              {step.openApi.summary}
            </Text>
          )}
        </HStack>
      )}
      marker={(
        <Text hasTabularNumbers type="supporting">{index + 1}</Text>
      )}
      startContent={formatStepBadge(step)}
      endContent={result !== undefined
        ? <RunStatus status={result.status} />
        : testFinished
          ? <RunStatus status="not-run" />
          : undefined}
    />
  );
}

function StepDetail({
  onOpenYaml,
  result,
  step,
}: {
  onOpenYaml: (definition: YamlDefinition) => void;
  result?: UiRunStepResult;
  step: ScenarioStep;
}) {
  const actualRequest = formatRunRequest(result?.url, result?.request);
  const actualResponse = formatRunResponse(result?.response);
  const request = actualRequest ?? formatRequestPreview(step.request);
  const response = actualResponse ?? formatResponsePreview(step.expectedResponse);
  const hasOpenApiMetadata = step.openApi !== undefined && (
    step.openApi.tags.length > 0 ||
    step.openApi.summary !== undefined ||
    step.openApi.description !== undefined
  );
  const hasRuntimeMetadata = step.input !== undefined || result?.input !== undefined ||
    step.condition !== undefined || result?.condition !== undefined ||
    step.extract !== undefined || (result?.extracts.length ?? 0) > 0;
  const definition = step.definition;

  return (
    <VStack
      aria-label={`${step.id} 단계 상세`}
      as="section"
      gap={4}
      paddingBlock={3}
      paddingInline={4}
    >
      {hasOpenApiMetadata && <OpenApiContract step={step} />}
      {request !== undefined && (
        <CodeBlock
          code={request}
          container="card"
          hasLanguageLabel={false}
          isWrapped
          language="json"
          size="sm"
          syntaxTheme={githubDark}
          title={actualRequest === undefined ? '요청 · 예정 구조' : '요청 · 실제'}
          width="100%"
        />
      )}
      {response !== undefined && (
        <CodeBlock
          code={response}
          container="card"
          hasLanguageLabel={false}
          isWrapped
          language="json"
          size="sm"
          syntaxTheme={githubDark}
          title={actualResponse === undefined ? '응답 · 예상 (OpenAPI)' : '응답 · 실제'}
          width="100%"
        />
      )}
      {hasRuntimeMetadata && (
        <MetadataList label={{ position: 'top' }}>
          {(result?.input ?? step.input) !== undefined && (
            <MetadataListItem label="입력">
              <Text type="supporting">
                {formatInputResult(step, result)}
              </Text>
            </MetadataListItem>
          )}
          {(result?.condition ?? step.condition) !== undefined && (
            <MetadataListItem label="검증">
              <HStack gap={2} vAlign="center" wrap="wrap">
                {result?.condition !== undefined && (
                  <RunStatus status={result.condition.passed ? 'passed' : 'failed'} />
                )}
                <Code>{result?.condition?.expression ?? step.condition}</Code>
              </HStack>
            </MetadataListItem>
          )}
          {(result?.extracts.length ?? 0) > 0 ? (
            <MetadataListItem label="추출">
              <VStack gap={1}>
                {result?.extracts.map((extract) => (
                  <HStack key={extract.name} gap={2} vAlign="center" wrap="wrap">
                    <RunStatus status={extract.passed ? 'passed' : 'failed'} />
                    <Text type="code">{extract.name} · {extract.path}</Text>
                    {extract.error !== undefined && (
                      <Text color="secondary" type="supporting">{extract.error}</Text>
                    )}
                  </HStack>
                ))}
              </VStack>
            </MetadataListItem>
          ) : step.extract !== undefined && (
            <MetadataListItem label="추출">
              <Text type="code">{step.extract.join(', ')}</Text>
            </MetadataListItem>
          )}
        </MetadataList>
      )}
      {result?.error !== undefined && (
        <Banner
          container="section"
          description={result.error}
          status="error"
          title="단계 실행 실패"
        />
      )}
      {definition !== undefined && (
        <Item
          density="compact"
          description="단계 원본 YAML"
          endContent={<Text color="secondary" type="supporting">보기</Text>}
          label={(
            <Text color="secondary" hasTruncateTooltip maxLines={1} type="code">
              {definition.path}
            </Text>
          )}
          onClick={() => onOpenYaml(definition)}
        />
      )}
      {request === undefined && response === undefined && !hasOpenApiMetadata && !hasRuntimeMetadata &&
        definition === undefined && (
        <Text color="secondary" type="supporting">표시할 상세 정보 없음</Text>
      )}
    </VStack>
  );
}

function OpenApiContract({ step }: { step: ScenarioStep }) {
  if (step.openApi === undefined) return null;

  return (
    <MetadataList label={{ position: 'top' }}>
      <MetadataListItem label="OpenAPI">
        <VStack gap={2}>
          {step.openApi.tags.length > 0 && (
            <HStack gap={1} vAlign="center" wrap="wrap">
              {step.openApi.tags.map((tag) => <Badge key={tag} label={tag} variant="teal" />)}
            </HStack>
          )}
          {step.openApi.summary !== undefined && (
            <Text type="label">{step.openApi.summary}</Text>
          )}
          {step.openApi.description !== undefined && (
            <Collapsible
              defaultIsOpen={false}
              trigger={<Text color="secondary" type="supporting">설명 보기</Text>}
            >
              <OpenApiDescription value={step.openApi.description} />
            </Collapsible>
          )}
        </VStack>
      </MetadataListItem>
    </MetadataList>
  );
}

function OpenApiDescription({ value }: { value: string }) {
  const lines = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <VStack gap={1}>
      {lines.map((line, index) => {
        const isBullet = line.startsWith('- ');
        const text = (isBullet ? line.slice(2) : line).replace(/\*\*/g, '');
        const isHeading = !isBullet && line.startsWith('**') && line.endsWith('**');

        if (isBullet) {
          return (
            <HStack key={`${index}:${line}`} gap={1} vAlign="start">
              <Text color="secondary" type="supporting">•</Text>
              <Text as="p" color="secondary" textWrap="pretty" type="supporting">{text}</Text>
            </HStack>
          );
        }

        return (
          <Text
            key={`${index}:${line}`}
            as="p"
            color={isHeading ? 'primary' : 'secondary'}
            textWrap="pretty"
            type={isHeading ? 'label' : 'supporting'}
          >
            {text}
          </Text>
        );
      })}
    </VStack>
  );
}

function RunStatus({ status }: { status: 'starting' | UiRunStatus | 'not-run' }) {
  const value = status === 'starting'
    ? { label: '시작 중', variant: 'accent' as const }
    : status === 'running'
      ? { label: '실행 중', variant: 'accent' as const }
      : status === 'passed'
        ? { label: '성공', variant: 'success' as const }
        : status === 'failed'
          ? { label: '실패', variant: 'error' as const }
          : { label: '미실행', variant: 'neutral' as const };

  return (
    <HStack as="span" gap={1} vAlign="center">
      <StatusDot
        isPulsing={status === 'starting' || status === 'running'}
        label={value.label}
        variant={value.variant}
      />
      <Text type="supporting">{value.label}</Text>
    </HStack>
  );
}

function formatInputResult(step: ScenarioStep, result: UiRunStepResult | undefined): string {
  if (result?.input !== undefined) {
    const source = result.input.source === 'prompt'
      ? '화면 입력'
      : result.input.source === 'vars'
        ? '변수'
        : '미입력';
    return `${result.input.label ?? result.input.name} · ${source}${result.input.sensitive ? ' · 민감값' : ''}`;
  }

  if (step.input === undefined) return '';
  return `${step.input.label ?? step.input.name} · ${step.input.required ? '필수' : '선택'}${step.input.sensitive ? ' · 민감값' : ''}`;
}

function TargetRow({ module, name }: { module?: ModuleCheck; name: string }) {
  const status = module?.status ?? 'unknown';
  const label = status === 'reachable' ? '연결됨' : status === 'failed' ? '실패' : '미확인';

  return (
    <HStack gap={2} vAlign="center">
      <StatusDot
        label={`${name} ${label}`}
        tooltip={`${name} ${label}`}
        variant={status === 'reachable' ? 'success' : status === 'failed' ? 'error' : 'neutral'}
      />
      <Text type="label">{name}</Text>
      <Text color="secondary" hasTruncateTooltip maxLines={1} type="code">
        {module?.baseUrl ?? 'URL 미설정'}
      </Text>
      <Text color="secondary" type="supporting">{label}</Text>
    </HStack>
  );
}

function collectIncludedYamlDefinitions(
  detail: UiScenarioDetail | undefined,
  scenarioPath: string | undefined,
): IncludedYamlDefinition[] {
  const definitions = new Map<string, IncludedYamlDefinition>();

  detail?.steps.forEach((step) => {
    step.source.lineage?.forEach((source) => {
      const definition = source.definition;
      if (
        definition === undefined ||
        definition.path === scenarioPath ||
        definitions.has(definition.path)
      ) {
        return;
      }

      definitions.set(definition.path, {
        ...definition,
        source: `${source.kind === 'use' ? '시나리오 사용' : '파일 포함'} · ${source.reference}`,
      });
    });
  });

  return [...definitions.values()];
}

function findScenarioReferenceLines(code: string): number[] {
  // ponytail: documented block syntax only; use the YAML AST if alternate forms need highlighting.
  return code.split('\n').flatMap((line, index) => (
    /^\s*-\s+(?:use|include)\s*:/.test(line) ? [index + 1] : []
  ));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatStepBadge(step: ScenarioStep): ReactNode {
  if (step.input !== undefined) {
    return <Badge label="INPUT" variant="purple" />;
  }

  if (step.method !== undefined) {
    const method = step.method.toUpperCase();
    return <Badge label={method} variant={httpMethodBadgeVariant(method)} />;
  }

  return <Badge label="API" variant="neutral" />;
}

function formatStepPath(step: ScenarioStep): string {
  if (step.input !== undefined) return step.input.name;
  if (step.path !== undefined) return step.path;
  if (step.operationId !== undefined) return `operationId ${step.operationId}`;
  return 'endpoint 미해석';
}

function httpMethodBadgeVariant(
  method: string,
): 'blue' | 'cyan' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'yellow' | 'neutral' {
  switch (method) {
    case 'GET': return 'green';
    case 'POST': return 'blue';
    case 'PUT': return 'orange';
    case 'PATCH': return 'cyan';
    case 'DELETE': return 'red';
    case 'HEAD': return 'purple';
    case 'OPTIONS': return 'teal';
    case 'TRACE': return 'pink';
    default: return 'neutral';
  }
}

function formatStepSource(step: ScenarioStep): string | undefined {
  if (step.source.kind === 'direct') return undefined;

  const lineage = step.source.lineage ?? (
    step.source.reference === undefined ? [] : [step.source]
  );
  const references = lineage.map((source) => source.reference).join(' › ');
  return references === '' ? '출처 미확인' : `포함 · ${references}`;
}
