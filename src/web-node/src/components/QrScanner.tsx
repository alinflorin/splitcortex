import { makeStyles } from '@fluentui/react-components';
import jsQR from 'jsqr';
import { useEffect, useRef } from 'react';
import { GLASS } from '../theme/glass';

const useStyles = makeStyles({
  video: {
    width: '100%',
    maxWidth: '420px',
    aspectRatio: '1',
    objectFit: 'cover',
    borderRadius: '16px',
    ...GLASS.well,
  },
});

/**
 * Shows the rear camera and calls `onScan` with the text of the first QR code it reads, or `onError` when the camera
 * cannot be used (no camera, permission refused, insecure context). The camera stops when this unmounts. Frames are
 * decoded in the page (jsQR, bundled); nothing leaves the device.
 */
export function QrScanner({
  onScan,
  onError,
}: {
  onScan: (data: string) => void;
  onError: () => void;
}) {
  const styles = useStyles();
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onScan, onError });
  callbacks.current = { onScan, onError };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const canvas = document.createElement('canvas');

    const tick = () => {
      const v = video.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (stopped || !v || !ctx) return;
      if (v.readyState >= 2 && v.videoWidth > 0) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = jsQR(img.data, img.width, img.height);
        if (hit?.data) {
          callbacks.current.onScan(hit.data);
          return;
        }
      }
      timer = window.setTimeout(tick, 150);
    };

    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        await v.play();
        tick();
      } catch {
        if (!stopped) callbacks.current.onError();
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return <video ref={video} className={styles.video} muted playsInline />;
}
