import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Tab,
  TabList,
  Text,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Copy20Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildKeyExamples, getGatewayBaseUrl } from '../../lib/gateway';
import { useToast } from '../../components/feedback/useToast';
import { GLASS } from '../../theme/glass';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  row: { display: 'flex', gap: tokens.spacingHorizontalS },
  code: {
    margin: 0,
    padding: tokens.spacingHorizontalM,
    overflowX: 'auto',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    ...GLASS.well,
    borderRadius: tokens.borderRadiusMedium,
  },
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

  const [tab, setTab] = useState<'curl' | 'python'>('curl');
  const examples = secret ? buildKeyExamples(getGatewayBaseUrl(), secret) : null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
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
              <Button icon={<Copy20Regular />} onClick={() => void copy(secret ?? '')}>
                {t('apiKeys.copy')}
              </Button>
            </div>
            {examples && (
              <>
                <Text weight="semibold">{t('apiKeys.useTitle')}</Text>
                <Text size={200}>{t('apiKeys.useHint')}</Text>
                <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)}>
                  <Tab value="curl">curl</Tab>
                  <Tab value="python">Python</Tab>
                </TabList>
                <pre className={styles.code}>{examples[tab]}</pre>
                <div>
                  <Button icon={<Copy20Regular />} onClick={() => void copy(examples[tab])}>
                    {t('apiKeys.copyExample')}
                  </Button>
                </div>
              </>
            )}
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
