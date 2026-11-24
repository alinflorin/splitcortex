/**
 * Displacement map for the liquid-glass refraction filter (see `components/marketing/LiquidGlass.tsx`).
 *
 * RGBA bytes for a `width` x `height` rounded rectangle: red = horizontal shift, green = vertical shift,
 * 128 = no shift. Inside the rim band (`bezel` px from the edge) pixels point along the edge normal,
 * with a squared falloff, so the middle of the glass stays flat and the strongest bend sits at the rim.
 * The shift points inwards (a convex lens shows what lies further in at its edge).
 */
export function computeGlassMap(
  width: number,
  height: number,
  radius: number,
  bezel: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const hx = width / 2;
  const hy = height / 2;
  const r = Math.min(radius, hx, hy);
  const bx = hx - r;
  const by = hy - r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - hx;
      const py = y + 0.5 - hy;
      const qx = Math.abs(px) - bx;
      const qy = Math.abs(py) - by;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      // signed distance to the rounded rectangle, negative inside
      const sd = outside + Math.min(Math.max(qx, qy), 0) - r;
      const depth = -sd;
      let dx = 0;
      let dy = 0;
      if (depth >= 0 && depth < bezel) {
        // outward normal of the rounded rectangle at this pixel
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1;
          nx = (qx / len) * Math.sign(px);
          ny = (qy / len) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py);
        }
        const t = 1 - depth / bezel;
        const strength = t * t;
        dx = -nx * strength;
        dy = -ny * strength;
      }
      const i = (y * width + x) * 4;
      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return data;
}
