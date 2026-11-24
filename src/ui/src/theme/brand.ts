/**
 * Brand colours, taken exactly from the logo (`public/logo.svg`): violet `#6C7BF2` → `#4A5BE6`
 * (left hemisphere) and mint `#2CE6C5` → cyan `#14B8D4` (right hemisphere). Every brand colour in
 * the app comes from here; do not write these hex values anywhere else.
 */
export const BRAND = {
  violetLight: '#6C7BF2',
  violet: '#4A5BE6',
  mint: '#2CE6C5',
  cyan: '#14B8D4',
} as const;

/** `#rrggbb` + alpha → `rgba(...)`, for soft brand glows. */
const rgba = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** Brand gradient (violet into cyan): icon tiles, big numbers, the call to action. */
export const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND.violetLight} 0%, ${BRAND.violet} 45%, ${BRAND.cyan} 100%)`;

/** Mint into cyan, the logo's right hemisphere. */
export const BRAND_GRADIENT_MINT = `linear-gradient(135deg, ${BRAND.mint} 0%, ${BRAND.cyan} 100%)`;

/** Soft coloured glow under brand-filled elements. */
export const BRAND_SHADOW = `0 10px 28px ${rgba(BRAND.violet, 0.35)}`;

/** Aurora behind public pages: violet top right, mint top left, fading out long before any edge. */
export const BRAND_AURORA = `radial-gradient(900px 520px at 88% -120px, ${rgba(BRAND.violet, 0.22)}, transparent 70%), radial-gradient(700px 420px at 4% -80px, ${rgba(BRAND.mint, 0.12)}, transparent 70%)`;

/**
 * The page backdrop that glass refracts: two aurora glows plus a dot grid (last layer, tiled).
 * Dots use `currentColor`-neutral grey at low alpha so they read in light and dark.
 */
export const BRAND_BACKDROP = `radial-gradient(1100px 640px at 90% -140px, ${rgba(BRAND.violet, 0.3)}, transparent 70%), radial-gradient(900px 560px at 2% 18%, ${rgba(BRAND.mint, 0.16)}, transparent 70%), radial-gradient(circle at 1px 1px, rgba(127, 135, 170, 0.28) 1.2px, transparent 1.6px)`;

/**
 * Fluent's brand tokens (buttons, links, focus, active nav, ...) generated from `BRAND.violet`
 * (`createLightTheme` / `createDarkTheme`), laid over the Teams themes so only the brand colour
 * changes. Regenerate them if the logo's violet ever changes. The green palette / success tokens
 * are the same lightness as Fluent's, hue moved to the logo's mint, so "ok" states read as brand mint.
 */
export const LIGHT_BRAND_TOKENS = {
  colorBrandBackground: '#4A5BE6',
  colorBrandBackground2: '#f4f5fb',
  colorBrandBackground2Hover: '#e4e6f6',
  colorBrandBackground2Pressed: '#c0c7ed',
  colorBrandBackground3Static: '#344ddd',
  colorBrandBackground4Static: '#293a9d',
  colorBrandBackgroundHover: '#435be4',
  colorBrandBackgroundInverted: '#ffffff',
  colorBrandBackgroundInvertedHover: '#f4f5fb',
  colorBrandBackgroundInvertedPressed: '#d3d7f1',
  colorBrandBackgroundInvertedSelected: '#e4e6f6',
  colorBrandBackgroundPressed: '#293a9d',
  colorBrandBackgroundSelected: '#344ddd',
  colorBrandBackgroundStatic: '#4A5BE6',
  colorBrandForeground1: '#4A5BE6',
  colorBrandForeground2: '#435be4',
  colorBrandForeground2Hover: '#344ddd',
  colorBrandForeground2Pressed: '#25306f',
  colorBrandForegroundInverted: '#8191e7',
  colorBrandForegroundInvertedHover: '#98a4e8',
  colorBrandForegroundInvertedPressed: '#8191e7',
  colorBrandForegroundLink: '#435be4',
  colorBrandForegroundLinkHover: '#344ddd',
  colorBrandForegroundLinkPressed: '#293a9d',
  colorBrandForegroundLinkSelected: '#435be4',
  colorBrandForegroundOnLight: '#4A5BE6',
  colorBrandForegroundOnLightHover: '#435be4',
  colorBrandForegroundOnLightPressed: '#2941c7',
  colorBrandForegroundOnLightSelected: '#344ddd',
  colorBrandShadowAmbient: 'rgba(0,0,0,0.30)',
  colorBrandShadowKey: 'rgba(0,0,0,0.25)',
  colorBrandStroke1: '#4A5BE6',
  colorBrandStroke2: '#d3d7f1',
  colorBrandStroke2Contrast: '#d3d7f1',
  colorBrandStroke2Hover: '#adb6ea',
  colorBrandStroke2Pressed: '#4A5BE6',
  colorCompoundBrandBackground: '#4A5BE6',
  colorCompoundBrandBackgroundHover: '#435be4',
  colorCompoundBrandBackgroundPressed: '#344ddd',
  colorCompoundBrandForeground1: '#4A5BE6',
  colorCompoundBrandForeground1Hover: '#435be4',
  colorCompoundBrandForeground1Pressed: '#344ddd',
  colorCompoundBrandStroke: '#4A5BE6',
  colorCompoundBrandStrokeHover: '#435be4',
  colorCompoundBrandStrokePressed: '#344ddd',
  colorNeutralForeground2BrandHover: '#4A5BE6',
  colorNeutralForeground2BrandPressed: '#435be4',
  colorNeutralForeground2BrandSelected: '#4A5BE6',
  colorNeutralForeground3BrandHover: '#4A5BE6',
  colorNeutralForeground3BrandPressed: '#435be4',
  colorNeutralForeground3BrandSelected: '#4A5BE6',
  colorNeutralForegroundOnBrand: '#ffffff',
  colorNeutralStrokeOnBrand: '#ffffff',
  colorNeutralStrokeOnBrand2: '#ffffff',
  colorNeutralStrokeOnBrand2Hover: '#ffffff',
  colorNeutralStrokeOnBrand2Pressed: '#ffffff',
  colorNeutralStrokeOnBrand2Selected: '#ffffff',
  shadow16Brand: '0 0 2px rgba(0,0,0,0.30), 0 8px 16px rgba(0,0,0,0.25)',
  shadow28Brand: '0 0 8px rgba(0,0,0,0.30), 0 14px 28px rgba(0,0,0,0.25)',
  shadow2Brand: '0 0 2px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.25)',
  shadow4Brand: '0 0 2px rgba(0,0,0,0.30), 0 2px 4px rgba(0,0,0,0.25)',
  shadow64Brand: '0 0 8px rgba(0,0,0,0.30), 0 32px 64px rgba(0,0,0,0.25)',
  shadow8Brand: '0 0 2px rgba(0,0,0,0.30), 0 4px 8px rgba(0,0,0,0.25)',
  // Success = the logo's mint: Fluent's green palette/status tokens, same lightness, hue moved to mint.
  colorPaletteGreenBackground1: '#f1faf8',
  colorPaletteGreenBackground2: '#9fd8ce',
  colorPaletteGreenBackground3: '#107c69',
  colorPaletteGreenBorder1: '#9fd8ce',
  colorPaletteGreenBorder2: '#107c69',
  colorPaletteGreenBorderActive: '#2CE6C5',
  colorPaletteGreenForeground1: '#0e705f',
  colorPaletteGreenForeground2: '#09453a',
  colorPaletteGreenForeground3: '#107c69',
  colorPaletteGreenForegroundInverted: '#359b89',
  colorStatusSuccessBackground1: '#f1faf8',
  colorStatusSuccessBackground2: '#9fd8ce',
  colorStatusSuccessBackground3: '#107c69',
  colorStatusSuccessBorder1: '#9fd8ce',
  colorStatusSuccessBorder2: '#107c69',
  colorStatusSuccessBorderActive: '#2CE6C5',
  colorStatusSuccessForeground1: '#0e705f',
  colorStatusSuccessForeground2: '#09453a',
  colorStatusSuccessForeground3: '#107c69',
  colorStatusSuccessForegroundInverted: '#54b0a0',
};

export const DARK_BRAND_TOKENS = {
  colorBrandBackground: '#4A5BE6',
  colorBrandBackground2: '#1d2347',
  colorBrandBackground2Hover: '#293eb2',
  colorBrandBackground2Pressed: '#090a10',
  colorBrandBackground3Static: '#4159e4',
  colorBrandBackground4Static: '#293eb2',
  colorBrandBackgroundHover: '#6679e7',
  colorBrandBackgroundInverted: '#ffffff',
  colorBrandBackgroundInvertedHover: '#f4f5fb',
  colorBrandBackgroundInvertedPressed: '#d6dbf2',
  colorBrandBackgroundInvertedSelected: '#e6e8f6',
  colorBrandBackgroundPressed: '#293eb2',
  colorBrandBackgroundSelected: '#4159e4',
  colorBrandBackgroundStatic: '#6679e7',
  colorBrandForeground1: '#919ee8',
  colorBrandForeground2: '#a4aee9',
  colorBrandForeground2Hover: '#c7cdee',
  colorBrandForeground2Pressed: '#f4f5fb',
  colorBrandForegroundInverted: '#6679e7',
  colorBrandForegroundInvertedHover: '#4A5BE6',
  colorBrandForegroundInvertedPressed: '#4159e4',
  colorBrandForegroundLink: '#919ee8',
  colorBrandForegroundLinkHover: '#a4aee9',
  colorBrandForegroundLinkPressed: '#7c8ce7',
  colorBrandForegroundLinkSelected: '#919ee8',
  colorBrandForegroundOnLight: '#6679e7',
  colorBrandForegroundOnLightHover: '#4A5BE6',
  colorBrandForegroundOnLightPressed: '#2d47d9',
  colorBrandForegroundOnLightSelected: '#4159e4',
  colorBrandShadowAmbient: 'rgba(0,0,0,0.30)',
  colorBrandShadowKey: 'rgba(0,0,0,0.25)',
  colorBrandStroke1: '#919ee8',
  colorBrandStroke2: '#2d47d9',
  colorBrandStroke2Contrast: '#2d47d9',
  colorBrandStroke2Hover: '#2d47d9',
  colorBrandStroke2Pressed: '#27347e',
  colorCompoundBrandBackground: '#919ee8',
  colorCompoundBrandBackgroundHover: '#a4aee9',
  colorCompoundBrandBackgroundPressed: '#7c8ce7',
  colorCompoundBrandForeground1: '#919ee8',
  colorCompoundBrandForeground1Hover: '#a4aee9',
  colorCompoundBrandForeground1Pressed: '#7c8ce7',
  colorCompoundBrandStroke: '#919ee8',
  colorCompoundBrandStrokeHover: '#a4aee9',
  colorCompoundBrandStrokePressed: '#7c8ce7',
  colorNeutralForeground2BrandHover: '#919ee8',
  colorNeutralForeground2BrandPressed: '#7c8ce7',
  colorNeutralForeground2BrandSelected: '#919ee8',
  colorNeutralForeground3BrandHover: '#919ee8',
  colorNeutralForeground3BrandPressed: '#7c8ce7',
  colorNeutralForeground3BrandSelected: '#919ee8',
  colorNeutralForegroundOnBrand: '#ffffff',
  colorNeutralStrokeOnBrand: '#292929',
  colorNeutralStrokeOnBrand2: '#ffffff',
  colorNeutralStrokeOnBrand2Hover: '#ffffff',
  colorNeutralStrokeOnBrand2Pressed: '#ffffff',
  colorNeutralStrokeOnBrand2Selected: '#ffffff',
  shadow16Brand: '0 0 2px rgba(0,0,0,0.30), 0 8px 16px rgba(0,0,0,0.25)',
  shadow28Brand: '0 0 8px rgba(0,0,0,0.30), 0 14px 28px rgba(0,0,0,0.25)',
  shadow2Brand: '0 0 2px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.25)',
  shadow4Brand: '0 0 2px rgba(0,0,0,0.30), 0 2px 4px rgba(0,0,0,0.25)',
  shadow64Brand: '0 0 8px rgba(0,0,0,0.30), 0 32px 64px rgba(0,0,0,0.25)',
  shadow8Brand: '0 0 2px rgba(0,0,0,0.30), 0 4px 8px rgba(0,0,0,0.25)',
  // Success = the logo's mint: Fluent's green palette/status tokens, same lightness, hue moved to mint.
  colorPaletteGreenBackground1: '#05251f',
  colorPaletteGreenBackground2: '#09453a',
  colorPaletteGreenBackground3: '#107c69',
  colorPaletteGreenBorder1: '#107c69',
  colorPaletteGreenBorder2: '#9fd8ce',
  colorPaletteGreenBorderActive: '#2CE6C5',
  colorPaletteGreenForeground1: '#54b0a0',
  colorPaletteGreenForeground2: '#9fd8ce',
  colorPaletteGreenForeground3: '#9fd8ce',
  colorPaletteGreenForegroundInverted: '#107c69',
  colorStatusSuccessBackground1: '#05251f',
  colorStatusSuccessBackground2: '#09453a',
  colorStatusSuccessBackground3: '#107c69',
  colorStatusSuccessBorder1: '#107c69',
  colorStatusSuccessBorder2: '#9fd8ce',
  colorStatusSuccessBorderActive: '#2CE6C5',
  colorStatusSuccessForeground1: '#54b0a0',
  colorStatusSuccessForeground2: '#9fd8ce',
  colorStatusSuccessForeground3: '#9fd8ce',
  colorStatusSuccessForegroundInverted: '#0e705f',
};
