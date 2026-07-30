import { AppShell } from '@astryxdesign/core/AppShell';
import { VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';

export function App() {
  return (
    <AppShell contentPadding={6} height="fill" variant="section">
      <VStack gap={2}>
        <Heading level={1}>openapi-k6 UI</Heading>
        <Text as="p" type="supporting">
          React/Astryx 화면 기반 준비 완료
        </Text>
      </VStack>
    </AppShell>
  );
}
