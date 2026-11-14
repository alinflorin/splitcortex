import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = makeStyles({
  fields: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
});

interface FormDialogProps {
  open: boolean;
  title: string;
  submitLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

/** Modal form shell: title, fields, Cancel / submit. The caller owns the react-hook-form instance. */
export function FormDialog({
  open,
  title,
  submitLabel,
  busy,
  onClose,
  onSubmit,
  children,
}: FormDialogProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form noValidate onSubmit={onSubmit}>
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent className={styles.fields}>{children}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" type="submit" disabled={busy}>
                {submitLabel}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
