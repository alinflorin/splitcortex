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
  const { theme: t } = useTheme();
  const off = disabled || loading;
  const palette = {
    primary: {
      bg: t.colorBrandBackground,
      pressed: t.colorBrandBackgroundPressed,
      fg: t.colorNeutralForegroundOnBrand,
      border: 'transparent',
    },
    secondary: {
      bg: t.colorNeutralBackground1,
      pressed: t.colorNeutralBackground1Pressed,
      fg: t.colorNeutralForeground1,
      border: t.colorNeutralStroke1,
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
        borderRadius: parseFloat(t.borderRadiusMedium),
        borderWidth: parseFloat(t.strokeWidthThin),
        borderColor: palette.border,
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
