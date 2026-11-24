import { useState } from 'react';
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
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: parseFloat(t.spacingVerticalXS) }}>
      <Text variant="caption" style={{ fontFamily: fontFamilyForWeight(t.fontWeightSemibold) }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.colorNeutralForeground4}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          {
            minHeight: 44,
            paddingHorizontal: parseFloat(t.spacingHorizontalM),
            borderRadius: 12,
            borderWidth: parseFloat(t.strokeWidthThin),
            borderColor: error
              ? t.colorPaletteRedBorder2
              : focused
                ? t.colorBrandStroke1
                : `${t.colorNeutralForeground1}47`,
            // The focus ring: a halo all round (no bar under the field), like the web inputs.
            boxShadow: focused ? `0 0 0 3px ${t.colorBrandStroke1}47` : undefined,
            backgroundColor: `${t.colorNeutralBackground1}59`,
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
