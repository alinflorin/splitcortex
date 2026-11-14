import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { fontFamilyForWeight } from '../theme/fonts';
import { useTheme } from '../theme/ThemeContext';

type Variant = 'title' | 'subtitle' | 'body' | 'caption';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  muted?: boolean;
}

/** Fluent type ramp: title = Title 3, subtitle = Subtitle 2, body = Base 300, caption = Base 200. */
export function Text({ variant = 'body', muted, style, ...rest }: TextProps) {
  const { theme: t } = useTheme();
  const ramp = {
    title: [t.fontSizeBase600, t.lineHeightBase600, t.fontWeightSemibold],
    subtitle: [t.fontSizeBase400, t.lineHeightBase400, t.fontWeightSemibold],
    body: [t.fontSizeBase300, t.lineHeightBase300, t.fontWeightRegular],
    caption: [t.fontSizeBase200, t.lineHeightBase200, t.fontWeightRegular],
  }[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          fontSize: parseFloat(String(ramp[0])),
          lineHeight: parseFloat(String(ramp[1])),
          fontFamily: fontFamilyForWeight(ramp[2]),
          color: muted ? t.colorNeutralForeground3 : t.colorNeutralForeground1,
        },
        style,
      ]}
    />
  );
}
