import { TextInput, View, type TextInputProps } from 'react-native';
import { fontFamilyForWeight } from '../theme/fonts';
import { useTheme } from '../theme/ThemeContext';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

/** Labelled single-line input in the Fluent look (hairline border, no shadow). */
export function TextField({ label, hint, error, mono, style, ...rest }: TextFieldProps) {
  const { theme: t } = useTheme();
  return (
    <View style={{ gap: parseFloat(t.spacingVerticalXS) }}>
      <Text variant="caption" style={{ fontFamily: fontFamilyForWeight(t.fontWeightSemibold) }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.colorNeutralForeground4}
        {...rest}
        style={[
          {
            minHeight: 44,
            paddingHorizontal: parseFloat(t.spacingHorizontalM),
            borderRadius: parseFloat(t.borderRadiusMedium),
            borderWidth: parseFloat(t.strokeWidthThin),
            borderColor: error ? t.colorPaletteRedBorder2 : t.colorNeutralStroke1,
            backgroundColor: t.colorNeutralBackground1,
            color: t.colorNeutralForeground1,
            fontFamily: mono ? 'monospace' : fontFamilyForWeight(t.fontWeightRegular),
            fontSize: parseFloat(t.fontSizeBase300),
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" style={{ color: t.colorPaletteRedForeground1 }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
