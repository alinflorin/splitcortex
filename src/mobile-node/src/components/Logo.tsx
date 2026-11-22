import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const HEMISPHERE =
  'M476 140C476 112 442 108 412 115C382 122 368 140 362 152C325 142 275 162 255 198C210 202 165 242 162 292C118 312 95 362 108 415C65 452 48 518 68 585C55 642 85 702 145 722C155 785 215 832 285 825C305 875 365 902 418 892C452 885 476 865 476 838Z';

/** Same artwork as the web app's `public/logo.svg` (keep the two in sync). */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1000 1000" accessibilityLabel="SplitCortex">
      <Defs>
        <LinearGradient id="sc-left" gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="0" y2="900">
          <Stop offset="0" stopColor="#6C7BF2" />
          <Stop offset="1" stopColor="#4A5BE6" />
        </LinearGradient>
        <LinearGradient
          id="sc-right"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="100"
          x2="0"
          y2="900"
        >
          <Stop offset="0" stopColor="#2CE6C5" />
          <Stop offset="1" stopColor="#14B8D4" />
        </LinearGradient>
      </Defs>
      <Path d={HEMISPHERE} fill="url(#sc-left)" />
      <Path d={HEMISPHERE} fill="url(#sc-right)" transform="translate(1000 0) scale(-1 1)" />
    </Svg>
  );
}
