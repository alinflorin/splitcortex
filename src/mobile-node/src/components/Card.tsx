import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/** Filled surface, no border or shadow, generous padding: matches the web cards. */
export function Card({ style, ...rest }: ViewProps) {
  const { theme: t } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: t.colorNeutralBackground2,
          borderRadius: 16,
          padding: parseFloat(t.spacingHorizontalXL),
          gap: parseFloat(t.spacingVerticalM),
        },
        style,
      ]}
    />
  );
}
