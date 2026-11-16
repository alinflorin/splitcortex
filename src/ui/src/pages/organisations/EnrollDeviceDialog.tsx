import { useEffect, useRef, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowClockwise20Regular, Copy20Regular } from '@fluentui/react-icons';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { useCancelEnrollment, useCreateEnrollment, useNodes } from '../../api/hooks';
import type { CreatedEnrollment, Pool } from '../../api/schemas';
import { useToast } from '../../components/feedback/useToast';
import { getApiBaseUrl } from '../../lib/gateway';

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    alignItems: 'center',
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeHero800,
    letterSpacing: '0.08em',
    userSelect: 'all',
    textAlign: 'center',
  },
  qr: {
    width: '224px',
    height: '224px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  muted: { color: tokens.colorNeutralForeground3, textAlign: 'center' },
  address: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    width: '100%',
  },
  addressRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  addressUrl: {
    flexGrow: 1,
    minWidth: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    wordBreak: 'break-all',
  },
});

/** What the QR carries: the app's deep link with the enrollment URL (the control plane) and the same code. */
export const enrollLink = (code: string) =>
  `splitcortex://enroll?url=${encodeURIComponent(`${window.location.origin}/api`)}&code=${encodeURIComponent(code)}`;

function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 0;
}

/**
 * Creates an enrollment code for the pool and shows it as text and as a QR (the QR is a convenience: the code
 * works typed in). Closes by itself when a new device shows up in the pool.
 */
export function EnrollDeviceDialog({
  pool,
  open,
  onClose,
}: {
  pool: Pool;
  open: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateEnrollment(pool.orgId, pool.id);
  const cancel = useCancelEnrollment(pool.orgId);
  const nodes = useNodes(pool.orgId, pool.id);
  const [created, setCreated] = useState<CreatedEnrollment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const baseline = useRef<Set<string> | null>(null);
  const started = useRef(false);
  const remaining = useCountdown(created?.enrollment.expiresAt);

  const generate = () => {
    baseline.current = new Set(nodes.data?.map((n) => n.id));
    setCreated(null);
    setQr(null);
    create.mutate(undefined, { onSuccess: setCreated });
  };

  // Create a code when the dialog opens (once, even under StrictMode).
  useEffect(() => {
    if (!open) {
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!created) return;
    let cancelled = false;
    void QRCode.toDataURL(enrollLink(created.code), { margin: 1, width: 224 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [created]);

  // Watch for the device to arrive.
  useEffect(() => {
    if (!open || !created) return;
    const timer = setInterval(() => void nodes.refetch(), 3000);
    return () => clearInterval(timer);
  }, [open, created, nodes]);
  const arrived = nodes.data?.find((n) => baseline.current && !baseline.current.has(n.id));
  useEffect(() => {
    if (!arrived || !open) return;
    toast.success(t('enroll.done', { name: arrived.name }));
    setCreated(null); // already consumed: nothing to cancel
    onClose();
  }, [arrived?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (created && remaining > 0) cancel.mutate(created.enrollment.id);
    setCreated(null);
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created?.code ?? '');
      toast.success(t('enroll.copied'));
    } catch {
      // clipboard blocked: the code stays selectable
    }
  };

  const apiUrl = getApiBaseUrl();
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(apiUrl);
      toast.success(t('enroll.apiUrlCopied'));
    } catch {
      // clipboard blocked: the address stays selectable
    }
  };

  const expired = created !== null && remaining === 0;
  const mm = String(Math.floor(remaining / 60));
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('enroll.title')}</DialogTitle>
          <DialogContent className={styles.body}>
            <Body1 className={styles.muted}>{t('enroll.intro')}</Body1>
            {!created ? (
              <Spinner label={t('common.loading')} />
            ) : (
              <>
                <div className={styles.code} data-testid="enroll-code">
                  {created.code}
                </div>
                {qr && <img className={styles.qr} src={qr} alt={t('enroll.qrAlt')} />}
                <Caption1 className={styles.muted}>
                  {expired ? t('enroll.expired') : t('enroll.expires', { time: `${mm}:${ss}` })}
                </Caption1>
                <div className={styles.address}>
                  <Caption1 className={styles.muted}>{t('enroll.apiUrl')}</Caption1>
                  <div className={styles.addressRow}>
                    <code className={styles.addressUrl} data-testid="enroll-api-url">
                      {apiUrl}
                    </code>
                    <Button
                      icon={<Copy20Regular />}
                      aria-label={t('enroll.copyApiUrl')}
                      onClick={() => void copyUrl()}
                    />
                  </div>
                </div>
                {pool.requireApproval && (
                  <Caption1 className={styles.muted}>{t('enroll.approvalNote')}</Caption1>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              icon={<Copy20Regular />}
              disabled={!created || expired}
              onClick={() => void copy()}
            >
              {t('enroll.copy')}
            </Button>
            <Button
              icon={<ArrowClockwise20Regular />}
              disabled={create.isPending}
              onClick={() => {
                if (created && !expired) cancel.mutate(created.enrollment.id);
                generate();
              }}
            >
              {t('enroll.newCode')}
            </Button>
            <Button appearance="primary" onClick={close}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
