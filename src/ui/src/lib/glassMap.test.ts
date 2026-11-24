import { describe, expect, it } from 'vitest';
import { computeGlassMap } from './glassMap';

const at = (data: Uint8ClampedArray, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

describe('computeGlassMap', () => {
  const w = 120;
  const h = 80;
  const map = computeGlassMap(w, h, 24, 16);

  it('has one RGBA pixel per cell, fully opaque', () => {
    expect(map.length).toBe(w * h * 4);
    expect(at(map, w, 3, 40)[3]).toBe(255);
  });

  it('leaves the middle of the glass undisplaced', () => {
    expect(at(map, w, 60, 40)).toEqual([128, 128, 128, 255]);
  });

  it('bends inwards at each edge, strongest at the rim', () => {
    const [leftR, leftG] = at(map, w, 0, 40);
    const [rightR] = at(map, w, w - 1, 40);
    const [, topG] = at(map, w, 60, 0);
    const [, bottomG] = at(map, w, 60, h - 1);
    expect(leftR).toBeGreaterThan(200);
    expect(leftG).toBe(128);
    expect(rightR).toBeLessThan(56);
    expect(topG).toBeGreaterThan(200);
    expect(bottomG).toBeLessThan(56);
    expect(at(map, w, 12, 40)[0] ?? 0).toBeLessThan(leftR ?? 0);
  });
});
