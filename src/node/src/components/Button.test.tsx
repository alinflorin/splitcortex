import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithTheme } from '../test/render';
import { Button } from './Button';

describe('Button', () => {
  it('calls onPress', async () => {
    const onPress = jest.fn();
    await renderWithTheme(<Button label="Go" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Go' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    await renderWithTheme(<Button label="Go" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Go' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
