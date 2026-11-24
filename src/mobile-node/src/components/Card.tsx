import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/** Translucent glass-look surface with a light rim, generous padding: matches the web cards. */
export function Card({ style, ...rest }: ViewProps) {
  const { theme: t, mode } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: `${t.colorNeutralBackground2}b8`,
          borderWidth: 1,
          // Edges come from the text colour (white in dark, ink in light): a fixed white rim vanished on light.
          borderColor: `${t.colorNeutralForeground1}24`,
          borderTopColor: mode === 'dark' ? `${t.colorNeutralForeground1}4d` : '#ffffffcc',
          borderRadius: 16,
          padding: parseFloat(t.spacingHorizontalXL),
          gap: parseFloat(t.spacingVerticalM),
        },
        style,
      ]}
    />
  );
}
