import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  /** Defaults to the translated "Confirm". */
  confirmLabel?: string;
  /** Defaults to the translated "Cancel". */
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (delete, revoke, ...). */
  destructive?: boolean;
}

const useStyles = makeStyles({
  danger: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    ':hover': { backgroundColor: tokens.colorPaletteRedForeground1 },
    ':hover:active': { backgroundColor: tokens.colorPaletteRedForeground1 },
  },
});

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onResult: (confirmed: boolean) => void;
}

/** Presentational dialog; use `useConfirm()` instead of rendering it directly. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onResult,
}: ConfirmDialogProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      modalType="alert"
      onOpenChange={(_, data) => {
        if (!data.open) onResult(false);
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          {message && <DialogContent>{message}</DialogContent>}
          <DialogActions>
            <Button appearance="secondary" onClick={() => onResult(false)}>
              {cancelLabel ?? t('common.cancel')}
            </Button>
            <Button
              appearance="primary"
              className={mergeClasses(destructive && styles.danger)}
              onClick={() => onResult(true)}
            >
              {confirmLabel ?? t('common.confirm')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
