import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  Stop,
} from 'react-native-svg';

/** Same artwork as the web app's `public/logo.svg` (keep the two in sync). */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1000 1000" accessibilityLabel="SplitCortex">
      <Defs>
        <LinearGradient id="leftBrainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#6C7BF2" />
          <Stop offset="100%" stopColor="#4A5BE6" />
        </LinearGradient>
        <LinearGradient id="rightBrainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#2CE6C5" />
          <Stop offset="100%" stopColor="#14B8D4" />
        </LinearGradient>
        <ClipPath id="leftClip">
          <Path d="M 476 140 C 476 112, 442 108, 412 115 C 382 122, 368 140, 362 152 C 325 142, 275 162, 255 198 C 210 202, 165 242, 162 292 C 118 312, 95 362, 108 415 C 65 452, 48 518, 68 585 C 55 642, 85 702, 145 722 C 155 785, 215 832, 285 825 C 305 875, 365 902, 418 892 C 452 885, 476 865, 476 838 Z" />
        </ClipPath>
        <ClipPath id="rightClip">
          <Path d="M 524 140 C 524 112, 558 108, 588 115 C 618 122, 632 140, 638 152 C 675 142, 725 162, 745 198 C 790 202, 835 242, 838 292 C 882 312, 905 362, 892 415 C 935 452, 952 518, 932 585 C 945 642, 915 702, 855 722 C 845 785, 785 832, 715 825 C 695 875, 635 902, 582 892 C 548 885, 524 865, 524 838 Z" />
        </ClipPath>
      </Defs>
      <G id="left-hemisphere">
        <Path
          d="M 476 140 C 476 112, 442 108, 412 115 C 382 122, 368 140, 362 152 C 325 142, 275 162, 255 198 C 210 202, 165 242, 162 292 C 118 312, 95 362, 108 415 C 65 452, 48 518, 68 585 C 55 642, 85 702, 145 722 C 155 785, 215 832, 285 825 C 305 875, 365 902, 418 892 C 452 885, 476 865, 476 838 Z"
          fill="url(#leftBrainGrad)"
        />
        <G clipPath="url(#leftClip)">
          <G fill="none" stroke="#3F4EC7" strokeWidth="8" strokeLinecap="round" opacity="0.55">
            <Path d="M 362 152 Q 345 182, 325 195" />
            <Path d="M 255 198 Q 250 228, 232 242" />
            <Path d="M 162 292 Q 182 315, 175 340" />
            <Path d="M 108 415 Q 135 422, 152 440" />
            <Path d="M 68 585 Q 98 592, 122 582" />
            <Path d="M 145 722 Q 175 712, 195 725" />
            <Path d="M 285 825 Q 295 795, 315 785" />
          </G>
          <G
            fill="none"
            stroke="#1E2B58"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Polygon points="248,308 362,308 418,364 418,418 355,418 355,382 332,360 272,360 246,386 246,432 272,458 345,458 418,531 418,632 355,695 245,695 182,632 182,580 245,580 245,616 268,638 332,638 356,614 356,554 332,530 248,530 182,464 182,374" />
            <Polyline
              points="386,385 348,347 262,347 224,385 224,442 262,480 342,480 388,526 388,622 346,664 258,664 214,620"
              strokeWidth="8"
            />
            <Polyline points="305,308 305,272 268,235" />
            <Polyline points="410,205 410,275 478,343" />
            <Polyline points="182,580 120,580" />
            <Polyline points="305,695 305,735 242,762" />
            <Polyline points="410,805 410,735 478,667" />
            <Line x1="418" y1="580" x2="478" y2="580" />
            <Polyline points="438,475 458,495 478,495" />
          </G>
          <G fill="#1E2B58">
            <Circle cx="386" cy="385" r="10" />
            <Circle cx="214" cy="620" r="10" />
            <Circle cx="438" cy="475" r="10" />
          </G>
          <G fill="#FFFFFF" stroke="#1E2B58" strokeWidth="11">
            <Circle cx="268" cy="235" r="16" />
            <Circle cx="410" cy="195" r="16" />
            <Circle cx="120" cy="580" r="16" />
            <Circle cx="242" cy="762" r="16" />
            <Circle cx="410" cy="812" r="16" />
          </G>
        </G>
      </G>
      <G id="right-hemisphere">
        <Path
          d="M 524 140 C 524 112, 558 108, 588 115 C 618 122, 632 140, 638 152 C 675 142, 725 162, 745 198 C 790 202, 835 242, 838 292 C 882 312, 905 362, 892 415 C 935 452, 952 518, 932 585 C 945 642, 915 702, 855 722 C 845 785, 785 832, 715 825 C 695 875, 635 902, 582 892 C 548 885, 524 865, 524 838 Z"
          fill="url(#rightBrainGrad)"
        />
        <G clipPath="url(#rightClip)">
          <G fill="none" stroke="#109EB5" strokeWidth="8" strokeLinecap="round" opacity="0.55">
            <Path d="M 638 152 Q 655 182, 675 195" />
            <Path d="M 745 198 Q 750 228, 768 242" />
            <Path d="M 838 292 Q 818 315, 825 340" />
            <Path d="M 892 415 Q 865 422, 848 440" />
            <Path d="M 932 585 Q 902 592, 878 582" />
            <Path d="M 855 722 Q 825 712, 805 725" />
            <Path d="M 715 825 Q 705 795, 685 785" />
          </G>
          <G
            fill="none"
            stroke="#123A4A"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Polygon points="648,308 755,308 818,371 818,425 755,425 755,388 732,364 668,364 644,388 644,612 668,636 732,636 755,612 755,575 818,575 818,629 755,692 648,692 582,626 582,374" />
            <Polyline points="786,392 746,352 658,352 612,398 612,518" strokeWidth="8" />
            <Polyline points="612,518 612,602 658,648 746,648 786,608" strokeWidth="8" />
            <Polyline points="590,195 590,275 522,343" />
            <Polyline points="695,308 695,272 732,235" />
            <Polyline points="582,425 522,425" />
            <Polyline points="582,465 522,465" />
            <Polyline points="582,535 522,535" />
            <Polyline points="725,500 818,500 862,456" />
            <Polyline points="818,575 880,575" />
            <Polyline points="695,692 695,735 758,762" />
            <Polyline points="590,812 590,735 522,667" />
          </G>
          <G fill="#123A4A">
            <Circle cx="786" cy="392" r="10" />
            <Circle cx="612" cy="518" r="10" />
            <Circle cx="786" cy="608" r="10" />
          </G>
          <G fill="#FFFFFF" stroke="#123A4A" strokeWidth="11">
            <Circle cx="590" cy="195" r="16" />
            <Circle cx="732" cy="235" r="16" />
            <Circle cx="725" cy="500" r="16" />
            <Circle cx="880" cy="575" r="16" />
            <Circle cx="758" cy="762" r="16" />
            <Circle cx="590" cy="812" r="16" />
          </G>
        </G>
      </G>
    </Svg>
  );
}
