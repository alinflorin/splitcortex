import { Text, View } from 'react-native';
import { fontFamilyForWeight } from '../theme/fonts';
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
        <Text style={{ color: '#14b8d4' }}>split</Text>
        <Text style={{ color: '#4f5df0' }}>cortex</Text>
      </Text>
    </View>
  );
}
