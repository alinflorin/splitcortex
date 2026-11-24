import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { computeGlassMap } from '../../lib/glassMap';

const useStyles = makeStyles({
  glass: {
    position: 'relative',
    isolation: 'isolate',
    // The finished look without refraction (Safari, Firefox, phones): tint, small blur, rim light, sheen.
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 38%, transparent)`,
    backdropFilter: 'blur(8px) saturate(160%)',
    WebkitBackdropFilter: 'blur(8px) saturate(160%)',
    boxShadow: [
      'inset 0 1px 0 rgba(255, 255, 255, 0.45)',
      'inset 0 -1px 0 rgba(255, 255, 255, 0.08)',
      'inset 0 0 0 1px rgba(255, 255, 255, 0.14)',
      // An edge in the text colour, inside the box, so the glass stays visible on a light page.
      `inset 0 0 0 1px color-mix(in srgb, ${tokens.colorNeutralForeground1} 10%, transparent)`,
      // Negative spread keeps the drop shadow under the box: a wider one is cut square by a clipping parent.
      '0 22px 28px -22px rgba(0, 0, 0, 0.3)',
    ].join(', '),
    '::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderRadius: 'inherit',
      pointerEvents: 'none',
      zIndex: -1,
      backgroundImage:
        'radial-gradient(120% 90% at 12% 0%, rgba(255, 255, 255, 0.28), transparent 55%)',
    },
    '@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)': {
      backgroundColor: tokens.colorNeutralBackground2,
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },
  },
});

/** `url()` in `backdrop-filter` is parsed everywhere but only drawn by Chromium, so test the engine, not `@supports`. */
function canRefract(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
  const chromium = !!nav.userAgentData?.brands.some((b) => b.brand === 'Chromium');
  const calm = window.matchMedia?.(
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more)',
  ).matches;
  return chromium && !calm;
}

/**
 * A liquid-glass surface: a frosted CSS layer everywhere, plus, in Chromium, real refraction at the rim
 * (an SVG `feDisplacementMap` fed with a map drawn from the element's own size, used through
 * `backdrop-filter: url(#...)`). Each instance owns its filter because the map must match its size.
 * Use it for a few surfaces that sit over something colourful: every glass re-reads what is behind it.
 */
export function LiquidGlass({
  radius = 24,
  bezel = 18,
  scale = 56,
  className,
  style,
  children,
}: {
  radius?: number;
  bezel?: number;
  scale?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const styles = useStyles();
  const ref = useRef<HTMLDivElement>(null);
  const image = useRef<SVGFEImageElement>(null);
  const id = `lg-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [refracting, setRefracting] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !canRefract()) return;
    let timer = 0;
    const draw = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      const feImage = image.current;
      if (!feImage || w < 2 || h < 2) return;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pixels = ctx.createImageData(w, h);
      pixels.data.set(computeGlassMap(w, h, radius, bezel));
      ctx.putImageData(pixels, 0, 0);
      feImage.setAttribute('href', canvas.toDataURL());
      feImage.setAttribute('width', String(w));
      feImage.setAttribute('height', String(h));
      setRefracting(true);
    };
    draw();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(draw, 120);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [radius, bezel]);

  const refraction: CSSProperties = refracting
    ? {
        backdropFilter: `url(#${id}) blur(1px) saturate(160%)`,
        WebkitBackdropFilter: `url(#${id}) blur(1px) saturate(160%)`,
      }
    : {};

  return (
    <div
      ref={ref}
      className={mergeClasses(styles.glass, className)}
      style={{ borderRadius: radius, ...refraction, ...style }}
    >
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
        style={{ position: 'absolute' }}
      >
        <defs>
          <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            <feImage ref={image} x="0" y="0" preserveAspectRatio="none" result="map" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      {children}
    </div>
  );
}
