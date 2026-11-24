import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../../theme/brand';
import { useTheme } from '../../theme/ThemeContext';
import type { TourScene } from './tourScene';

const useStyles = makeStyles({
  // Tall block; the stage sticks inside the page's scroll area while it passes.
  outer: { position: 'relative', height: '480vh', marginTop: '56px' },
  stage: {
    position: 'sticky',
    top: 0,
    height: 'calc(100dvh - 64px)',
    overflow: 'hidden',
    backgroundColor: '#0a0e2b',
    color: '#fff',
  },
  stageLight: { backgroundColor: '#eef1ff', color: '#14173d' },
  canvas: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
  shade: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    background: 'linear-gradient(90deg, rgba(10,14,43,0.78) 0%, rgba(10,14,43,0) 60%)',
  },
  shadeLight: {
    background: 'linear-gradient(90deg, rgba(238,241,255,0.9) 0%, rgba(238,241,255,0) 60%)',
  },
  chapter: {
    position: 'absolute',
    left: 'max(32px, calc((100% - 1280px) / 2 + 32px))',
    bottom: '18%',
    maxWidth: '440px',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    opacity: 0,
    '@media (max-width: 799px)': { left: '12px', right: '12px', bottom: '14%' },
  },
  eyebrow: {
    color: BRAND.mint,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    fontSize: '12px',
  },
  eyebrowLight: { color: '#0b7f94' },
  num: { fontSize: '14px', color: BRAND.violetLight, fontWeight: 600 },
  numLight: { color: BRAND.violet },
  title: {
    margin: 0,
    fontSize: '40px',
    lineHeight: '44px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    '@media (max-width: 799px)': { fontSize: '28px', lineHeight: '32px' },
  },
  body: { fontSize: '17px', lineHeight: '26px', opacity: 0.85 },
  bar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: '3px',
    width: '100%',
    transformOrigin: 'left',
    transform: 'scaleX(0)',
    background: `linear-gradient(90deg, ${BRAND.violetLight}, ${BRAND.mint})`,
  },
  hint: {
    position: 'absolute',
    right: '32px',
    bottom: '24px',
    fontSize: '13px',
    opacity: 0.7,
    transitionProperty: 'opacity',
    transitionDuration: '300ms',
  },
});

const CHAPTERS = 4;

/** Scroll-driven fly-through of a data centre of small devices (Three.js, loaded on demand). */
export default function ScrollTour() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { mode } = useTheme();
  const light = mode === 'light';
  const outer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const chapters = useRef<(HTMLDivElement | null)[]>([]);
  const sceneRef = useRef<TourScene | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const el = canvas.current;
    const host = outer.current;
    if (!el || !host) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;
    let frame = 0;
    let cleanup = () => undefined as void;

    void import('./tourScene').then(({ createTourScene }) => {
      if (disposed) return;
      let scene: TourScene;
      try {
        scene = createTourScene(el, { lowPower: reduced || window.innerWidth < 800 });
      } catch {
        host.style.display = 'none'; // no WebGL: the rest of the page stands on its own
        return;
      }
      sceneRef.current = scene;
      scene.setTheme(modeRef.current);

      const fit = () => scene.resize(el.clientWidth, el.clientHeight);
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      const onMove = (e: PointerEvent) =>
        scene.setPointer(
          (e.clientX / window.innerWidth) * 2 - 1,
          (e.clientY / window.innerHeight) * 2 - 1,
        );
      window.addEventListener('pointermove', onMove);

      let visible = true;
      const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
      io.observe(host);

      let current = 0;
      const tick = (time: number) => {
        frame = requestAnimationFrame(tick);
        if (!visible) return;
        const rect = host.getBoundingClientRect();
        const travel = rect.height - window.innerHeight;
        const target = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
        current += (target - current) * 0.07;
        scene.setProgress(current);
        scene.render(time);
        if (bar.current) bar.current.style.transform = `scaleX(${current})`;
        if (hint.current) hint.current.style.opacity = current < 0.03 ? '0.7' : '0';
        chapters.current.forEach((c, i) => {
          if (!c) return;
          const centre = (i + 0.5) / CHAPTERS;
          const o = Math.min(1, Math.max(0, (0.13 - Math.abs(current - centre)) / 0.03));
          c.style.opacity = String(o);
          c.style.transform = `translateY(${(1 - o) * 16}px)`;
        });
      };

      if (reduced) {
        scene.setProgress(0.45);
        scene.render(0);
        chapters.current[1]?.style.setProperty('opacity', '1');
      } else {
        frame = requestAnimationFrame(tick);
      }
      cleanup = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener('pointermove', onMove);
        scene.dispose();
        sceneRef.current = undefined;
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(mode);
  }, [mode]);

  const items = t('home.tour.chapters', { returnObjects: true }) as {
    title: string;
    body: string;
  }[];

  return (
    <div ref={outer} className={styles.outer} aria-label={t('home.tour.eyebrow')} role="img">
      <div className={mergeClasses(styles.stage, light && styles.stageLight)}>
        <canvas ref={canvas} className={styles.canvas} aria-hidden />
        <div className={mergeClasses(styles.shade, light && styles.shadeLight)} />
        {items.slice(0, CHAPTERS).map((c, i) => (
          <div
            key={c.title}
            ref={(n) => {
              chapters.current[i] = n;
            }}
            className={styles.chapter}
          >
            <span className={mergeClasses(styles.eyebrow, light && styles.eyebrowLight)}>
              {t('home.tour.eyebrow')}
            </span>
            <span
              className={mergeClasses(styles.num, light && styles.numLight)}
            >{`0${i + 1}`}</span>
            <h2 className={styles.title}>{c.title}</h2>
            <span className={styles.body}>{c.body}</span>
          </div>
        ))}
        <span ref={hint} className={styles.hint}>
          {t('home.tour.scroll')}
        </span>
        <div ref={bar} className={styles.bar} />
      </div>
    </div>
  );
}
