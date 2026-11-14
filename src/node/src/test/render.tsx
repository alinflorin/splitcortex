import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../theme/ThemeContext';

/** Renders inside the theme provider (components read tokens through useTheme). */
export function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}
