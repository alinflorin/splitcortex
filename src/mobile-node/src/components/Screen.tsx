import { ScrollView, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

export function Screen({ contentContainerStyle, ...rest }: ScrollViewProps) {
  const { theme: t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      {...rest}
      style={{ flex: 1, backgroundColor: t.colorNeutralBackground2 }}
      contentContainerStyle={[
        {
          padding: parseFloat(t.spacingHorizontalL),
          paddingBottom: insets.bottom + parseFloat(t.spacingVerticalXXL),
          gap: parseFloat(t.spacingVerticalL),
        },
        contentContainerStyle,
      ]}
    />
  );
}
