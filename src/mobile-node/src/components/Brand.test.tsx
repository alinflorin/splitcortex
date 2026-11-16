import { screen } from '@testing-library/react-native';
import { renderWithTheme } from '../test/render';
import { Brand } from './Brand';

describe('Brand', () => {
  it('renders the wordmark', async () => {
    await renderWithTheme(<Brand />);
    expect(screen.getByRole('header')).toHaveTextContent('splitcortex');
  });
});
