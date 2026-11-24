import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/** Translucent glass-look surface with a light rim, generous padding: matches the web cards. */
export function Card({ style, ...rest }: ViewProps) {
  const { theme: t } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: `${t.colorNeutralBackground2}b8`,
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.14)',
          borderTopColor: 'rgba(255, 255, 255, 0.3)',
          borderRadius: 16,
          padding: parseFloat(t.spacingHorizontalXL),
          gap: parseFloat(t.spacingVerticalM),
        },
        style,
      ]}
    />
  );
}
