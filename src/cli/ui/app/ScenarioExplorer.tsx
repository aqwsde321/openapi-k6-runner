import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Stack, StackItem } from '@astryxdesign/core/Stack';
import { StatusDot, type StatusDotVariant } from '@astryxdesign/core/StatusDot';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useMemo, useState } from 'react';

import type { UiScenarioList } from '../scenarios.js';
import type { UiSuiteList } from '../suites.js';
import { groupExplorerItems, type ExplorerGroup } from './explorer-groups';
import {
  selectLatestUiRun,
  type ScenarioRunStatus,
  type UiRuns,
} from './scenario-runs';

export type ExplorerMode = 'scenario' | 'suite';

type ScenarioItem = UiScenarioList['scenarios'][number];
type SuiteItem = UiSuiteList['suites'][number];
type ExplorerItem = ScenarioItem | SuiteItem;

export interface ScenarioExplorerProps {
  mode: ExplorerMode;
  onModeChange: (mode: ExplorerMode) => void;
  scenarios?: UiScenarioList;
  suites?: UiSuiteList;
  selectedId?: string;
  onSelect: (id: string) => void;
  runs: UiRuns;
  loading?: boolean;
  error?: string;
}

export function ScenarioExplorer({
  mode,
  onModeChange,
  scenarios,
  suites,
  selectedId,
  onSelect,
  runs,
  loading = false,
  error,
}: ScenarioExplorerProps) {
  const [query, setQuery] = useState('');
  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [treeRevision, setTreeRevision] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const allItems = useMemo<ExplorerItem[]>(
    () => mode === 'scenario' ? (scenarios?.scenarios ?? []) : (suites?.suites ?? []),
    [mode, scenarios, suites],
  );
  const filteredItems = useMemo(
    () => allItems.filter((item) => matchesQuery(item, normalizedQuery)),
    [allItems, normalizedQuery],
  );
  const treeItems = useMemo(
    () => buildTreeItems(
      groupExplorerItems(filteredItems),
      mode,
      selectedId,
      onSelect,
      normalizedQuery !== '' || groupsExpanded,
      runs,
    ),
    [filteredItems, groupsExpanded, mode, normalizedQuery, onSelect, runs, selectedId],
  );

  const setAllGroups = (expanded: boolean) => {
    setGroupsExpanded(expanded);
    setTreeRevision((revision) => revision + 1);
  };

  return (
    <Stack height="100%">
      <Stack paddingInline={2} paddingBlock={1}>
        <TabList
          aria-label="탐색 대상"
          hasDivider
          layout="fill"
          onChange={(value) => onModeChange(value as ExplorerMode)}
          size="sm"
          value={mode}
        >
          <Tab
            endContent={<Badge label={String(scenarios?.scenarios.length ?? 0)} />}
            label="시나리오"
            value="scenario"
          />
          <Tab
            endContent={<Badge label={String(suites?.suites.length ?? 0)} />}
            label="스위트"
            value="suite"
          />
        </TabList>
      </Stack>

      <Stack direction="horizontal" gap={1} paddingInline={2} paddingBlock={2} vAlign="center">
        <StackItem size="fill">
          <TextInput
            hasClear
            isLabelHidden
            isLoading={loading}
            label={mode === 'scenario' ? '시나리오 검색' : '스위트 검색'}
            onChange={setQuery}
            placeholder={mode === 'scenario' ? '시나리오 검색' : '스위트 검색'}
            size="sm"
            startIcon={<Icon icon="search" size="sm" />}
            value={query}
            width="100%"
          />
        </StackItem>
        <IconButton
          icon={<Icon icon="arrowUp" />}
          label="전체 접기"
          onClick={() => setAllGroups(false)}
          size="sm"
          tooltip="전체 접기"
          variant="ghost"
        />
        <IconButton
          icon={<Icon icon="arrowDown" />}
          label="전체 펼치기"
          onClick={() => setAllGroups(true)}
          size="sm"
          tooltip="전체 펼치기"
          variant="ghost"
        />
      </Stack>

      {error !== undefined && allItems.length > 0 && (
        <Banner
          container="section"
          description={error}
          status="error"
          title="목록 갱신 실패"
        />
      )}

      <StackItem isScrollable size="fill">
        {loading && allItems.length === 0 ? (
          <EmptyState
            icon={<Icon icon="clock" />}
            isCompact
            title="목록 불러오는 중"
          />
        ) : error !== undefined && allItems.length === 0 ? (
          <EmptyState
            description={error}
            icon={<Icon icon="error" color="error" />}
            isCompact
            title="목록을 불러오지 못함"
          />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            isCompact
            title={normalizedQuery === '' ? '등록된 항목 없음' : '검색 결과 없음'}
          />
        ) : (
          <Stack paddingInline={1} paddingBlock={1}>
            <TreeList
              key={`${mode}:${normalizedQuery}:${treeRevision}`}
              density="compact"
              header={(
                <VisuallyHidden>
                  {mode === 'scenario' ? '시나리오 목록' : '스위트 목록'}
                </VisuallyHidden>
              )}
              items={treeItems}
            />
          </Stack>
        )}
      </StackItem>
    </Stack>
  );
}

function matchesQuery(item: ExplorerItem, query: string): boolean {
  if (query === '') {
    return true;
  }

  const values = [item.name, item.path, item.group, item.description ?? ''];
  if ('scenarios' in item) {
    values.push(...(item.scenarios ?? []));
  }
  return values.some((value) => value.toLowerCase().includes(query));
}

function buildTreeItems(
  groups: ExplorerGroup<ExplorerItem>[],
  mode: ExplorerMode,
  selectedId: string | undefined,
  onSelect: (id: string) => void,
  isExpanded: boolean,
  runs: UiRuns,
): TreeListItemData[] {
  return groups.map((group) => ({
    id: `group:${mode}:${group.key}`,
    label: <Text type="label" weight="semibold">{group.label}</Text>,
    endContent: <Badge label={String(group.count)} />,
    isExpanded,
    children: [
      ...buildTreeItems(group.children, mode, selectedId, onSelect, isExpanded, runs),
      ...group.items.map((item) => {
        const run = selectLatestUiRun(runs, { kind: mode, id: item.id });
        const status = formatItemStatus(run?.status);
        return {
          id: `item:${mode}:${item.id}`,
          label: (
            <Text hasTruncateTooltip maxLines={1} type="label">
              {formatItemLabel(item)}
            </Text>
          ),
          ...(item.error === undefined
            ? {}
            : {
                description: item.error,
                startContent: <Icon icon="error" color="error" label="파싱 오류" size="sm" />,
              }),
          endContent: item.error === undefined ? (
            <HStack gap={1} vAlign="center">
              <Badge label={String(getItemCount(item, mode) ?? 0)} />
              <StatusDot
                isPulsing={run?.status === 'starting' || run?.status === 'running'}
                label={status.label}
                tooltip={status.label}
                variant={status.variant}
              />
              <Text color="secondary" type="supporting">{status.label}</Text>
            </HStack>
          ) : <Badge label="오류" variant="error" />,
          isSelected: item.id === selectedId,
          onClick: () => onSelect(item.id),
        };
      }),
    ],
  }));
}

function formatItemStatus(status: ScenarioRunStatus | undefined): {
  label: string;
  variant: StatusDotVariant;
} {
  if (status === 'starting') return { label: '시작', variant: 'accent' };
  if (status === 'running') return { label: '실행 중', variant: 'accent' };
  if (status === 'passed') return { label: '성공', variant: 'success' };
  if (status === 'failed') return { label: '실패', variant: 'error' };
  return { label: '미실행', variant: 'neutral' };
}

function formatItemLabel(item: ExplorerItem): string {
  const prefix = `${item.group}/`;
  return item.group !== 'root' && item.name.toLowerCase().startsWith(prefix.toLowerCase())
    ? item.name.slice(prefix.length) || item.name
    : item.name;
}

function getItemCount(item: ExplorerItem, mode: ExplorerMode): number | undefined {
  return mode === 'scenario' && 'stepCount' in item ? item.stepCount
    : mode === 'suite' && 'scenarioCount' in item ? item.scenarioCount
    : undefined;
}
