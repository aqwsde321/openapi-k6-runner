import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { StatusDot, type StatusDotVariant } from '@astryxdesign/core/StatusDot';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';

import type {
  UiRunChunk,
  UiRunInputRequest,
  UiRunStatus,
  UiSuiteRunResult,
  UiRunTestResult,
} from '../run-state.js';
import {
  reduceUiRuns,
  selectUiRun,
  type ScenarioRun,
  type ScenarioRunCommand,
  type UiRun,
  type UiRuns,
  type UiRunTarget,
  type UiRunTargetKind,
} from './scenario-runs';
import { startUiScenarioRun, startUiSuiteRun, submitUiRunInput } from './api';

export interface UiRunController {
  runs: UiRuns;
  start(target: UiRunTarget, command: ScenarioRunCommand): Promise<void>;
  submit(run: UiRun, value: string): Promise<void>;
}

export function useScenarioRunController(): UiRunController {
  const [runs, dispatch] = useReducer(reduceUiRuns, new Map() as UiRuns);
  const streams = useRef(new Map<string, EventSource>());

  useEffect(() => () => {
    for (const stream of streams.current.values()) stream.close();
    streams.current.clear();
  }, []);

  const connect = useCallback((target: UiRunTarget, command: ScenarioRunCommand, runId: string) => {
    const key = `${target.kind}\0${target.id}\0${command}`;
    streams.current.get(key)?.close();

    const stream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    streams.current.set(key, stream);
    const activeTarget = { ...target, command, runId };

    stream.onopen = () => dispatch({ type: 'connected', ...activeTarget });
    stream.onerror = () => dispatch({
      type: 'reconnecting',
      error: '실행 로그 연결이 끊겨 자동 재연결 중입니다.',
      ...activeTarget,
    });
    stream.addEventListener('chunk', (event) => {
      dispatch({ type: 'chunk', chunk: readEventData<UiRunChunk>(event), ...activeTarget });
    });
    stream.addEventListener('test-result', (event) => {
      dispatch({ type: 'test-result', result: readEventData<UiRunTestResult>(event), ...activeTarget });
    });
    stream.addEventListener('suite-result', (event) => {
      dispatch({ type: 'suite-result', result: readEventData<UiSuiteRunResult>(event), ...activeTarget });
    });
    stream.addEventListener('input-request', (event) => {
      dispatch({ type: 'input-request', request: readEventData<UiRunInputRequest>(event), ...activeTarget });
    });
    stream.addEventListener('input-submitted', () => {
      dispatch({ type: 'input-submitted', ...activeTarget });
    });
    stream.addEventListener('done', (event) => {
      const done = readEventData<{ status: Exclude<UiRunStatus, 'running'>; exitCode: number }>(event);
      dispatch({ type: 'done', ...done, at: new Date().toISOString(), ...activeTarget });
      stream.close();
      if (streams.current.get(key) === stream) streams.current.delete(key);
    });
  }, []);

  const start = useCallback(async (target: UiRunTarget, command: ScenarioRunCommand) => {
    const requestedAt = new Date().toISOString();
    dispatch({ type: 'requested', ...target, command, at: requestedAt });

    try {
      const result = target.kind === 'scenario'
        ? await startUiScenarioRun(command, target.id)
        : await startUiSuiteRun(command, target.id);
      dispatch({
        type: 'started',
        ...target,
        command,
        runId: result.runId,
        at: new Date().toISOString(),
      });
      connect(target, command, result.runId);
    } catch (error) {
      dispatch({
        type: 'start-failed',
        ...target,
        command,
        error: toErrorMessage(error),
        at: new Date().toISOString(),
      });
    }
  }, [connect]);

  const submit = useCallback(async (run: ScenarioRun, value: string) => {
    if (run.runId === undefined || run.pendingInput === undefined) {
      throw new Error('입력을 기다리는 실행이 아닙니다.');
    }

    await submitUiRunInput(run.runId, run.pendingInput.name, value);
    dispatch({
      type: 'input-submitted',
      ...run.target,
      command: run.command,
      runId: run.runId,
    });
  }, []);

  return { runs, start, submit };
}

export interface ScenarioRunPanelProps extends UiRunController {
  isReady: boolean;
  targetKind?: UiRunTargetKind;
  targetId?: string;
  targetName?: string;
  scenarioId?: string;
  scenarioName?: string;
}

export function ScenarioRunPanel({
  isReady,
  runs,
  scenarioId,
  scenarioName,
  start,
  submit,
  targetId: requestedTargetId,
  targetKind = 'scenario',
  targetName: requestedTargetName,
}: ScenarioRunPanelProps) {
  const [activeCommand, setActiveCommand] = useState<ScenarioRunCommand>('test');
  const targetId = requestedTargetId ?? scenarioId;
  const targetName = requestedTargetName ?? scenarioName;
  const target = targetId === undefined ? undefined : { kind: targetKind, id: targetId };
  const validateRun = target === undefined
    ? undefined
    : selectUiRun(runs, target, 'validate');
  const testRun = target === undefined
    ? undefined
    : selectUiRun(runs, target, 'test');
  const activeRun = activeCommand === 'validate' ? validateRun : testRun;
  const isBusy = [validateRun, testRun].some((run) => (
    run?.status === 'starting' || run?.status === 'running'
  ));

  useEffect(() => setActiveCommand('test'), [targetId, targetKind]);

  const run = async (command: ScenarioRunCommand) => {
    if (target === undefined || !isReady || isBusy) return;
    setActiveCommand(command);
    await start(target, command);
  };

  return (
    <VStack height="100%">
      <Toolbar
        dividers={['bottom']}
        endContent={(
          <HStack gap={2}>
            <Button
              clickAction={() => run('validate')}
              icon={<Icon icon="check" size="sm" />}
              isDisabled={!isReady || target === undefined || isBusy}
              label="검증"
              size="sm"
              variant="secondary"
            />
            <Button
              clickAction={() => run('test')}
              icon={<Icon icon="chevronRight" size="sm" />}
              isDisabled={!isReady || target === undefined || isBusy}
              label="실행"
              size="sm"
              variant="primary"
            />
          </HStack>
        )}
        label="실행 패널"
        size="sm"
        startContent={<Text type="label" weight="semibold">실행</Text>}
      />

      <TabList
        hasDivider
        layout="fill"
        onChange={(value) => setActiveCommand(value as ScenarioRunCommand)}
        size="sm"
        value={activeCommand}
      >
        <Tab label={formatTabLabel('검증', validateRun)} value="validate" />
        <Tab label={formatTabLabel('실행', testRun)} value="test" />
      </TabList>

      <StackItem isScrollable size="fill">
        <VStack gap={4} padding={4}>
          {target === undefined ? (
            <EmptyState
              description="탐색에서 실행할 시나리오 또는 스위트를 선택하세요."
              isCompact
              title="실행 대상 없음"
            />
          ) : activeRun === undefined ? (
            <EmptyState
              description={`${targetName ?? targetId} · ${activeCommand === 'validate' ? '검증' : '실행'}을 시작하세요.`}
              isCompact
              title="실행 대기"
            />
          ) : (
            <RunResult run={activeRun} submit={submit} />
          )}
        </VStack>
      </StackItem>
    </VStack>
  );
}

function RunResult({ run, submit }: { run: ScenarioRun; submit(run: ScenarioRun, value: string): Promise<void> }) {
  const status = formatRunStatus(run);
  const log = stripAnsi(run.chunks.map((chunk) => chunk.chunk).join(''));
  const passedSteps = run.testResult?.steps.filter((step) => step.status === 'passed').length
    ?? run.suiteResult?.scenarios.reduce((sum, scenario) => sum + scenario.passedSteps, 0);
  const totalSteps = run.testResult?.steps.length
    ?? run.suiteResult?.scenarios.reduce((sum, scenario) => sum + scenario.totalSteps, 0);
  const durationMs = run.testResult?.durationMs ?? run.suiteResult?.durationMs;

  return (
    <VStack gap={4}>
      <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
        <HStack gap={2} vAlign="center">
          <StatusDot
            isPulsing={run.status === 'starting' || run.status === 'running'}
            label={status.label}
            variant={status.variant}
          />
          <Text type="label" weight="semibold">{status.label}</Text>
        </HStack>
        <Text color="secondary" type="code">{run.target.id}</Text>
      </HStack>

      {(run.status === 'starting' || run.status === 'running') && (
        <ProgressBar isIndeterminate isLabelHidden label={status.label} />
      )}

      <HStack gap={3} wrap="wrap">
        {run.exitCode !== undefined && (
          <Text color="secondary" type="supporting">종료 {run.exitCode}</Text>
        )}
        {passedSteps !== undefined && totalSteps !== undefined && (
          <Text color="secondary" type="supporting">
            단계 {passedSteps}/{totalSteps}
          </Text>
        )}
        {durationMs !== undefined && (
          <Text color="secondary" type="supporting">{formatDuration(durationMs)}</Text>
        )}
        <Text color="secondary" type="supporting">
          {formatRunTime(run.finishedAt ?? run.startedAt ?? run.requestedAt)}
        </Text>
      </HStack>

      {run.error !== undefined && (
        <Banner
          container="section"
          description={run.error}
          status={run.connection === 'reconnecting' ? 'warning' : 'error'}
          title={run.connection === 'reconnecting' ? '실행 로그 재연결 중' : '명령 시작 실패'}
        />
      )}

      {run.pendingInput !== undefined && (
        <RunInputPrompt key={`${run.runId}:${run.pendingInput.id}`} run={run} submit={submit} />
      )}

      {run.testResult?.status === 'failed' && (
        <Banner
          container="section"
          description={formatFailedStep(run.testResult)}
          status="error"
          title="시나리오 실행 실패"
        />
      )}

      {run.suiteResult !== undefined && <SuiteRunSummary result={run.suiteResult} />}

      {log === '' ? (
        <Text color="secondary" type="supporting">로그 기다리는 중…</Text>
      ) : (
        <CodeBlock
          code={log}
          container="section"
          isWrapped
          language="plaintext"
          size="sm"
          title="실행 로그"
          width="100%"
        />
      )}
    </VStack>
  );
}

function SuiteRunSummary({ result }: { result: UiSuiteRunResult }) {
  const passedScenarios = result.scenarios.filter((scenario) => scenario.status === 'passed').length;
  const passedSteps = result.scenarios.reduce((sum, scenario) => sum + scenario.passedSteps, 0);
  const totalSteps = result.scenarios.reduce((sum, scenario) => sum + scenario.totalSteps, 0);

  return (
    <VStack gap={3}>
      <HStack gap={3} wrap="wrap">
        <Text color="secondary" type="supporting">
          시나리오 {passedScenarios}/{result.scenarios.length}
        </Text>
        <Text color="secondary" type="supporting">단계 {passedSteps}/{totalSteps}</Text>
        {result.reportPath !== undefined && (
          <Text color="secondary" hasTruncateTooltip maxLines={1} type="code">
            {result.reportPath}
          </Text>
        )}
      </HStack>

      <List
        density="compact"
        hasDividers
        header={<Text type="label" weight="semibold">시나리오 결과</Text>}
      >
        {result.scenarios.map((scenario) => (
          <ListItem
            key={scenario.scenarioKey}
            description={(
              <VStack gap={1}>
                <Text color="secondary" type="supporting">
                  {formatSuiteScenarioMeta(scenario)}
                </Text>
                {formatSuiteFailure(scenario) !== undefined && (
                  <Text color="secondary" type="supporting">{formatSuiteFailure(scenario)}</Text>
                )}
              </VStack>
            )}
            endContent={(
              <HStack gap={1} vAlign="center">
                <StatusDot
                  label={scenario.status === 'passed' ? '성공' : '실패'}
                  variant={scenario.status === 'passed' ? 'success' : 'error'}
                />
                <Text type="supporting">{scenario.status === 'passed' ? '성공' : '실패'}</Text>
              </HStack>
            )}
            label={scenario.scenarioName ?? scenario.scenarioKey}
          />
        ))}
      </List>
    </VStack>
  );
}

function RunInputPrompt({
  run,
  submit,
}: {
  run: ScenarioRun;
  submit(run: ScenarioRun, value: string): Promise<void>;
}) {
  const input = run.pendingInput;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (input === undefined) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (input.required && value === '') return;
    setError(undefined);
    setIsSubmitting(true);
    try {
      await submit(run, value);
      setValue('');
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Banner
      container="card"
      defaultIsExpanded
      description={`${input.index + 1}/${input.totalSteps} · ${input.id}`}
      status="warning"
      title="입력 필요"
    >
      <HStack as="form" gap={2} onSubmit={handleSubmit} vAlign="end" wrap="wrap">
        <StackItem size="fill">
          <TextInput
            hasAutoFocus
            isRequired={input.required}
            label={input.label ?? input.name}
            onChange={setValue}
            size="sm"
            status={error === undefined ? undefined : { type: 'error', message: error }}
            type={input.sensitive ? 'password' : 'text'}
            value={value}
            width="100%"
          />
        </StackItem>
        <Button
          isDisabled={input.required && value === ''}
          isLoading={isSubmitting}
          label="계속"
          size="sm"
          type="submit"
          variant="primary"
        />
      </HStack>
    </Banner>
  );
}

function formatTabLabel(label: string, run: ScenarioRun | undefined): string {
  if (run === undefined) return label;
  return `${label} · ${formatRunStatus(run).label}`;
}

function formatRunStatus(run: ScenarioRun): { label: string; variant: StatusDotVariant } {
  if (run.status === 'starting') return { label: '시작 중', variant: 'accent' };
  if (run.connection === 'reconnecting') return { label: '재연결 중', variant: 'warning' };
  if (run.pendingInput !== undefined) return { label: '입력 대기', variant: 'warning' };
  if (run.status === 'running') return { label: '실행 중', variant: 'accent' };
  if (run.status === 'passed') return { label: '성공', variant: 'success' };
  return { label: run.runId === undefined ? '시작 실패' : '실패', variant: 'error' };
}

function formatFailedStep(result: UiRunTestResult): string {
  const failed = result.steps.find((step) => step.status === 'failed');
  if (failed === undefined) return '실패한 단계 정보를 확인할 수 없습니다.';
  return [failed.id, failed.error, failed.responseStatus === undefined ? undefined : `HTTP ${failed.responseStatus}`]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
}

function formatSuiteScenarioMeta(scenario: UiSuiteRunResult['scenarios'][number]): string {
  return [
    [scenario.method, scenario.path].filter(Boolean).join(' '),
    `단계 ${scenario.passedSteps}/${scenario.totalSteps}`,
    formatDuration(scenario.durationMs),
  ].filter(Boolean).join(' · ');
}

function formatSuiteFailure(scenario: UiSuiteRunResult['scenarios'][number]): string | undefined {
  if (scenario.failedStep === undefined) return scenario.error;
  return [
    `실패 단계 ${scenario.failedStep.id}`,
    [scenario.failedStep.method, scenario.failedStep.path].filter(Boolean).join(' '),
    scenario.failedStep.responseStatus === undefined ? undefined : `HTTP ${scenario.failedStep.responseStatus}`,
    scenario.failedStep.condition,
    scenario.failedStep.error,
  ].filter((value): value is string => value !== undefined && value !== '').join(' · ');
}

function formatDuration(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

function formatRunTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function readEventData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
