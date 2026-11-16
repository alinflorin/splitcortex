import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/** Hairline border, generous padding, no shadow: matches the web cards. */
export function Card({ style, ...rest }: ViewProps) {
  const { theme: t } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: t.colorNeutralBackground1,
          borderColor: t.colorNeutralStroke2,
          borderWidth: parseFloat(t.strokeWidthThin),
          borderRadius: parseFloat(t.borderRadiusXLarge),
          padding: parseFloat(t.spacingHorizontalXL),
          gap: parseFloat(t.spacingVerticalM),
        },
        style,
      ]}
    />
  );
}
