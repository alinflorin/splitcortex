import { useEffect, useState } from 'react';
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
  Field,
  Input,
  ProgressBar,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ArrowDownload20Regular, Copy20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import {
  useActiveEnrollments,
  useCancelEnrollment,
  useCreateBulkEnrollments,
} from '../../api/hooks';
import { MAX_BULK_ENROLLMENTS } from '../../api/schemas';
import type { CreatedEnrollment, Pool } from '../../api/schemas';
import { useToast } from '../../components/feedback/useToast';
import { getApiBaseUrl } from '../../lib/gateway';
import { saveFile } from '../../lib/saveFile';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    maxHeight: '320px',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  code: { fontFamily: tokens.fontFamilyMonospace, letterSpacing: '0.06em', userSelect: 'all' },
  used: { textDecorationLine: 'line-through', color: tokens.colorNeutralForeground3 },
});

/** CSV with one code per line, for handing out or printing (the codes are secrets: keep the file private). */
export const bulkCodesCsv = (items: CreatedEnrollment[], poolName: string) =>
  [
    'code,pool,expires_at',
    ...items.map((i) => `${i.code},"${poolName.replace(/"/g, '""')}",${i.enrollment.expiresAt}`),
  ].join('\r\n') + '\r\n';

/**
 * Creates several single-use enrollment codes for one pool at once (one per device) and shows which ones have been
 * used. Codes keep the normal 10 minute life; closing cancels the ones nobody used.
 */
export function BulkEnrollDialog({
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
  const create = useCreateBulkEnrollments(pool.orgId, pool.id);
  const cancel = useCancelEnrollment(pool.orgId);
  const [count, setCount] = useState('5');
  const [items, setItems] = useState<CreatedEnrollment[] | null>(null);
  const active = useActiveEnrollments(pool.orgId, pool.id, open && items !== null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open || !items) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, items]);

  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_BULK_ENROLLMENTS;
  const expiresAt = items
    ? Math.min(...items.map((i) => new Date(i.enrollment.expiresAt).getTime()))
    : 0;
  const remaining = items ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  const stillActive = new Set(active.data?.map((e) => e.id));
  const isUsed = (i: CreatedEnrollment) =>
    active.data !== undefined && !stillActive.has(i.enrollment.id);
  const used = items ? items.filter(isUsed).length : 0;

  const close = async () => {
    if (items && remaining > 0 && active.data) {
      const unused = items.filter((i) => stillActive.has(i.enrollment.id));
      await Promise.allSettled(unused.map((i) => cancel.mutateAsync(i.enrollment.id)));
    }
    setItems(null);
    setCount('5');
    onClose();
  };

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      // clipboard blocked: the codes stay selectable
    }
  };

  const mm = String(Math.floor(remaining / 60));
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && void close()}>
      <DialogSurface>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!items && valid) create.mutate(n, { onSuccess: (r) => setItems(r.items) });
          }}
        >
          <DialogBody>
            <DialogTitle>{t('bulkEnroll.title')}</DialogTitle>
            <DialogContent className={styles.body}>
              {!items ? (
                <>
                  <Body1 className={styles.muted}>{t('bulkEnroll.intro')}</Body1>
                  <Field
                    label={t('bulkEnroll.count')}
                    hint={t('bulkEnroll.countHint', { max: MAX_BULK_ENROLLMENTS })}
                    validationMessage={
                      valid
                        ? undefined
                        : t('bulkEnroll.countInvalid', { max: MAX_BULK_ENROLLMENTS })
                    }
                  >
                    <Input
                      type="number"
                      min={1}
                      max={MAX_BULK_ENROLLMENTS}
                      value={count}
                      onChange={(_, d) => setCount(d.value)}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Body1 className={styles.muted}>
                    {remaining > 0
                      ? t('bulkEnroll.expires', { time: `${mm}:${ss}` })
                      : t('bulkEnroll.expired')}
                  </Body1>
                  <ProgressBar value={used / items.length} />
                  <Caption1 className={styles.muted}>
                    {t('bulkEnroll.progress', { used, total: items.length })}
                  </Caption1>
                  <div className={styles.list} data-testid="bulk-codes">
                    {items.map((i) => (
                      <div key={i.enrollment.id} className={styles.row}>
                        <span className={mergeClasses(styles.code, isUsed(i) && styles.used)}>
                          {i.code}
                        </span>
                        <Caption1 className={styles.muted}>
                          {isUsed(i) ? t('bulkEnroll.used') : ''}
                        </Caption1>
                      </div>
                    ))}
                  </div>
                  <Caption1 className={styles.muted}>
                    {t('bulkEnroll.apiUrl', { url: getApiBaseUrl() })}
                  </Caption1>
                  {pool.requireApproval && (
                    <Caption1 className={styles.muted}>{t('enroll.approvalNote')}</Caption1>
                  )}
                </>
              )}
            </DialogContent>
            <DialogActions>
              {items ? (
                <>
                  <Button
                    icon={<Copy20Regular />}
                    onClick={() =>
                      void copy(items.map((i) => i.code).join('\n'), t('bulkEnroll.copied'))
                    }
                  >
                    {t('bulkEnroll.copyAll')}
                  </Button>
                  <Button
                    icon={<ArrowDownload20Regular />}
                    onClick={() =>
                      saveFile(
                        new Blob([bulkCodesCsv(items, pool.name)], { type: 'text/csv' }),
                        'enrollment-codes.csv',
                      )
                    }
                  >
                    {t('bulkEnroll.download')}
                  </Button>
                  <Button appearance="primary" onClick={() => void close()}>
                    {t('common.close')}
                  </Button>
                </>
              ) : (
                <>
                  <Button appearance="secondary" onClick={() => void close()}>
                    {t('common.cancel')}
                  </Button>
                  <Button appearance="primary" type="submit" disabled={!valid || create.isPending}>
                    {t('bulkEnroll.create')}
                  </Button>
                </>
              )}
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
