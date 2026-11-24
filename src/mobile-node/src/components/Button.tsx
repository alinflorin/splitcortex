import { ActivityIndicator, Pressable, View } from 'react-native';
import { fontFamilyForWeight } from '../theme/fonts';
import { useTheme } from '../theme/ThemeContext';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  appearance?: 'primary' | 'secondary' | 'subtle';
  disabled?: boolean;
  loading?: boolean;
}

export function Button({
  label,
  onPress,
  appearance = 'secondary',
  disabled,
  loading,
}: ButtonProps) {
  const { theme: t, mode } = useTheme();
  const off = disabled || loading;
  const palette = {
    primary: {
      bg: `${t.colorBrandBackground}d0`,
      pressed: `${t.colorBrandBackgroundPressed}f0`,
      fg: t.colorNeutralForegroundOnBrand,
      border: 'rgba(255, 255, 255, 0.3)',
    },
    secondary: {
      bg: `${t.colorNeutralBackground1}8f`,
      pressed: `${t.colorNeutralBackground1}d0`,
      fg: t.colorNeutralForeground1,
      border: `${t.colorNeutralForeground1}2e`,
    },
    subtle: {
      bg: 'transparent',
      pressed: t.colorSubtleBackgroundPressed,
      fg: t.colorNeutralForeground2,
      border: 'transparent',
    },
  }[appearance];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: parseFloat(t.spacingHorizontalL),
        borderRadius: 12,
        borderWidth: parseFloat(t.strokeWidthThin),
        borderColor: palette.border,
        borderTopColor:
          appearance === 'subtle'
            ? 'transparent'
            : appearance === 'secondary' && mode === 'light'
              ? '#ffffffd9'
              : 'rgba(255, 255, 255, 0.42)',
        backgroundColor: pressed ? palette.pressed : palette.bg,
        opacity: off ? 0.5 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {loading ? <ActivityIndicator color={palette.fg} /> : null}
        <Text style={{ color: palette.fg, fontFamily: fontFamilyForWeight(t.fontWeightSemibold) }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
