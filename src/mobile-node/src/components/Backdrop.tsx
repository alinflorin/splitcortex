import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { BRAND } from '../theme/brand';

/**
 * Something to see behind translucent cards: two aurora glows over a faint dot grid, the same
 * backdrop the web app and web node draw in CSS. (No blur here: it would need a native module.)
 */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="violet" cx="90%" cy="0%" rx="90%" ry="45%" fx="90%" fy="0%">
            <Stop offset="0" stopColor={BRAND.violet} stopOpacity="0.32" />
            <Stop offset="1" stopColor={BRAND.violet} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="mint" cx="0%" cy="22%" rx="80%" ry="35%" fx="0%" fy="22%">
            <Stop offset="0" stopColor={BRAND.mint} stopOpacity="0.16" />
            <Stop offset="1" stopColor={BRAND.mint} stopOpacity="0" />
          </RadialGradient>
          <Pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
            <Circle cx="1.5" cy="1.5" r="1.2" fill="#7f87aa" fillOpacity="0.28" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#violet)" />
        <Rect width="100%" height="100%" fill="url(#mint)" />
        <Rect width="100%" height="100%" fill="url(#dots)" />
      </Svg>
    </View>
  );
}
