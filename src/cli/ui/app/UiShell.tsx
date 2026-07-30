import type { ReactNode } from 'react';

import { AppShell } from '@astryxdesign/core/AppShell';
import {
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
} from '@astryxdesign/core/Layout';
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { useMediaQuery } from '@astryxdesign/core/hooks';

export type MobileView = 'explorer' | 'flow' | 'run';

export interface UiShellProps {
  header: ReactNode;
  explorer: ReactNode;
  flow: ReactNode;
  run: ReactNode;
  mobileView: MobileView;
  onMobileViewChange(value: MobileView): void;
}

export function UiShell({
  header,
  explorer,
  flow,
  run,
  mobileView,
  onMobileViewChange,
}: UiShellProps) {
  const explorerPanel = useResizable({
    defaultSize: 300,
    minSizePx: 260,
    maxSizePx: 480,
    autoSaveId: 'openapi-k6.ui.explorer-panel-width',
  });
  const runPanel = useResizable({
    defaultSize: 420,
    minSizePx: 360,
    maxSizePx: 640,
    autoSaveId: 'openapi-k6.ui.run-panel-width',
  });
  const isMobile = useMediaQuery('(max-width: 1200px)');
  const mobilePanel = mobileView === 'explorer'
    ? explorer
    : mobileView === 'flow'
      ? flow
      : run;
  const mobilePanelLabel = mobileView === 'explorer' ? '탐색' : mobileView === 'flow' ? '흐름' : '실행';

  return (
    <AppShell
      contentPadding={0}
      height="fill"
      topNav={header}
      variant="section"
    >
      {isMobile ? (
        <Layout
          height="fill"
          header={(
            <LayoutHeader hasDivider padding={0}>
              <TabList
                aria-label="화면 선택"
                hasDivider={false}
                layout="fill"
                onChange={(value) => onMobileViewChange(value as MobileView)}
                size="sm"
                value={mobileView}
              >
                <Tab
                  label="탐색"
                  value="explorer"
                />
                <Tab
                  label="흐름"
                  value="flow"
                />
                <Tab
                  label="실행"
                  value="run"
                />
              </TabList>
            </LayoutHeader>
          )}
          content={(
            <LayoutContent
              isScrollable
              label={mobilePanelLabel}
              padding={0}
              role="tabpanel"
            >
              {mobilePanel}
            </LayoutContent>
          )}
        />
      ) : (
        <Layout
          height="fill"
          start={(
            <>
              <LayoutPanel
                hasDivider={false}
                label="시나리오 탐색"
                padding={0}
                resizable={explorerPanel.props}
                role="navigation"
              >
                {explorer}
              </LayoutPanel>
              <ResizeHandle
                hasDivider
                label="탐색 패널 너비 조절"
                resizable={explorerPanel.props}
              />
            </>
          )}
          content={(
            <LayoutContent
              isScrollable
              label="시나리오 흐름"
              padding={0}
              role="region"
            >
              {flow}
            </LayoutContent>
          )}
          end={(
            <>
              <ResizeHandle
                hasDivider
                isReversed
                label="실행 패널 너비 조절"
                resizable={runPanel.props}
              />
              <LayoutPanel
                hasDivider={false}
                label="시나리오 실행"
                padding={0}
                resizable={runPanel.props}
                role="complementary"
              >
                {run}
              </LayoutPanel>
            </>
          )}
        />
      )}
    </AppShell>
  );
}
