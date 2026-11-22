import { Text, View } from 'react-native';
import { fontFamilyForWeight } from '../theme/fonts';
import { BRAND } from '../theme/brand';
import { useTheme } from '../theme/ThemeContext';
import { Logo } from './Logo';

/** Logo + "splitcortex" wordmark, matching the web app sidebar header (Inter regular, lowercase, 16px). */
export function Brand() {
  const { theme: t } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: parseFloat(t.spacingHorizontalS) }}
    >
      <Logo size={36} />
      <Text
        accessibilityRole="header"
        style={{
          fontFamily: fontFamilyForWeight(t.fontWeightRegular),
          fontSize: parseFloat(t.fontSizeBase400),
        }}
      >
        <Text style={{ color: BRAND.mint }}>split</Text>
        <Text style={{ color: BRAND.violet }}>cortex</Text>
      </Text>
    </View>
  );
}
