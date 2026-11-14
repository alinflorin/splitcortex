import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Copy20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../components/feedback/useToast';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  row: { display: 'flex', gap: tokens.spacingHorizontalS },
  input: { flexGrow: 1, fontFamily: tokens.fontFamilyMonospace },
});

/** Shows a new key's secret once. The dialog cannot be dismissed by clicking outside, so it is not lost by accident. */
export function ApiKeySecretDialog({
  secret,
  onClose,
}: {
  secret: string | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret ?? '');
      toast.success(t('apiKeys.copied'));
    } catch {
      // clipboard blocked: the field stays selectable
    }
  };

  return (
    <Dialog open={secret !== null} modalType="alert">
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('apiKeys.secretTitle')}</DialogTitle>
          <DialogContent className={styles.body}>
            <MessageBar intent="warning">
              <MessageBarBody>{t('apiKeys.secretMessage')}</MessageBarBody>
            </MessageBar>
            <div className={styles.row}>
              <Input
                className={styles.input}
                readOnly
                value={secret ?? ''}
                aria-label={t('apiKeys.secretTitle')}
                onFocus={(e) => e.target.select()}
              />
              <Button icon={<Copy20Regular />} onClick={() => void copy()}>
                {t('apiKeys.copy')}
              </Button>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {t('apiKeys.done')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
