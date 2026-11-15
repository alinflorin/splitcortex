import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

/** Same artwork as the web app's `public/logo.svg` (keep the two in sync). */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="14 11 100 100" accessibilityLabel="SplitCortex">
      <Defs>
        <LinearGradient id="left" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7c8cff" />
          <Stop offset="1" stopColor="#4f5df0" />
        </LinearGradient>
        <LinearGradient id="right" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3be8d0" />
          <Stop offset="1" stopColor="#14b8d4" />
        </LinearGradient>
      </Defs>
      <Path
        d="M60 28 C50 22 36 25 32 36 C22 38 17 49 22 58 C16 66 19 78 28 82 C29 93 40 99 49 95 C54 100 60 98 60 92 Z"
        fill="url(#left)"
      />
      <G fill="none" stroke="#0e1330" strokeWidth={3.5} strokeLinecap="round" opacity={0.55}>
        <Path d="M32 36 C38 40 42 46 40 52" />
        <Path d="M22 58 C30 58 36 62 38 68" />
        <Path d="M28 82 C35 80 41 76 42 70" />
        <Path d="M49 95 C48 88 51 82 56 80" />
        <Path d="M60 46 C52 46 47 50 47 56" />
      </G>
      <Path
        d="M68 28 C78 22 92 25 96 36 C106 38 111 49 106 58 C112 66 109 78 100 82 C99 93 88 99 79 95 C74 100 68 98 68 92 Z"
        fill="url(#right)"
      />
      <G
        fill="none"
        stroke="#0e1330"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      >
        <Path d="M68 46 H82 L88 52 V60" />
        <Path d="M68 64 H92" />
        <Path d="M68 80 H80 L86 74 H98" />
      </G>
      <G fill="#0e1330">
        <Circle cx="88" cy="62" r="4" />
        <Circle cx="98" cy="74" r="4" />
      </G>
      <G fill="#e8fffb">
        <Circle cx="88" cy="62" r="1.8" />
        <Circle cx="98" cy="74" r="1.8" />
      </G>
    </Svg>
  );
}
