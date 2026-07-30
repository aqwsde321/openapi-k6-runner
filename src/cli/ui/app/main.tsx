import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

import { App } from './App';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('React root was not found');
}

createRoot(root).render(
  <StrictMode>
    <Theme mode="light" theme={neutralTheme}>
      <App />
    </Theme>
  </StrictMode>,
);
