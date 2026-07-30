export interface ExplorerGroup<T> {
  key: string;
  label: string;
  count: number;
  children: ExplorerGroup<T>[];
  items: T[];
}

export function groupExplorerItems<T extends { group: string }>(items: readonly T[]) {
  const root: ExplorerGroup<T> = { key: '', label: '', count: 0, children: [], items: [] };

  for (const item of items) {
    let parent = root;
    let key = '';
    const normalizedGroup = item.group.trim();
    const splitGroup = normalizedGroup.split('/').filter(Boolean);
    const parts = normalizedGroup === '' || normalizedGroup === 'root' || splitGroup.length === 0
      ? ['root']
      : splitGroup;

    for (const part of parts) {
      key = key === '' ? part : `${key}/${part}`;
      let group = parent.children.find((candidate) => candidate.key === key);

      if (group === undefined) {
        group = { key, label: part, count: 0, children: [], items: [] };
        parent.children.push(group);
      }

      group.count += 1;
      parent = group;
    }

    parent.items.push(item);
  }

  return root.children;
}
