import { Body1, Button, Caption1, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  Code24Regular,
  Copy20Regular,
  Desktop24Regular,
  Globe24Regular,
  Open20Regular,
  Phone24Regular,
  Share20Regular,
  ShoppingBag20Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getWebNodeUrl } from '../lib/webNode';
import { useToast } from './feedback/useToast';

const RELEASES = 'https://github.com/alinflorin/splitcortex/releases';
/** Each app has its own release stream (tags `mobile-node-v*` and `desktop-node-v*`), so link to just that one. */
export const MOBILE_RELEASES_URL = `${RELEASES}?q=mobile-node-v&expanded=true`;
export const DESKTOP_RELEASES_URL = `${RELEASES}?q=desktop-node-v&expanded=true`;
export const CLI_RELEASES_URL = `${RELEASES}?q=cli-node-v&expanded=true`;
/** The install scripts live in the repository (`src/cli-node`) and are fetched straight from GitHub. */
const CLI_RAW = 'https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node';
export const CLI_INSTALL_SH = `curl -fsSL ${CLI_RAW}/install.sh | sh`;
export const CLI_INSTALL_PS1 = `irm ${CLI_RAW}/install.ps1 | iex`;

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  head: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground2 },
  grid: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM },
  icon: { display: 'inline-flex', color: tokens.colorBrandForeground1 },
  command: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  commandRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  code: {
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
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    marginTop: 'auto',
  },
});

function AppCard({
  icon,
  title,
  body,
  extra,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.icon}>{icon}</span>
        <Text weight="semibold" size={400}>
          {title}
        </Text>
      </div>
      <Body1 className={styles.muted}>{body}</Body1>
      {extra}
      <div className={styles.actions}>{children}</div>
    </article>
  );
}

/**
 * Where to run a node: the phone app, the desktop app and the web node. They all behave the same way (enroll with a
 * code from "Add device"); the web node is only a link here, never opened with a code filled in.
 */
export function AppDownloads() {
  const styles = useStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const webNodeUrl = getWebNodeUrl();

  const share = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: t('apps.web.shareTitle'), url: webNodeUrl });
        return;
      }
      await navigator.clipboard.writeText(webNodeUrl);
      toast.success(t('apps.web.copied'));
    } catch (e) {
      // closing the share sheet is not an error
      if (e instanceof DOMException && e.name === 'AbortError') return;
      toast.error(t('apps.web.shareFailed'));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('apps.cli.copied'));
    } catch {
      toast.error(t('apps.cli.copyFailed'));
    }
  };

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  return (
    <section className={styles.root}>
      <div className={styles.head}>
        <Text weight="semibold" size={500}>
          {t('apps.title')}
        </Text>
        <Body1 className={styles.muted}>{t('apps.body')}</Body1>
      </div>
      <div className={styles.grid}>
        <AppCard
          icon={<Phone24Regular />}
          title={t('apps.mobile.title')}
          body={t('apps.mobile.body')}
        >
          <Button
            appearance="primary"
            icon={<ArrowDownload20Regular />}
            onClick={() => open(MOBILE_RELEASES_URL)}
          >
            {t('apps.mobile.apk')}
          </Button>
          {/* Store listings do not exist yet: these buttons are shown and do nothing. */}
          <Button icon={<ShoppingBag20Regular />} disabledFocusable>
            {t('apps.mobile.play')}
          </Button>
          <Button icon={<ShoppingBag20Regular />} disabledFocusable>
            {t('apps.mobile.ios')}
          </Button>
        </AppCard>
        <AppCard
          icon={<Desktop24Regular />}
          title={t('apps.desktop.title')}
          body={t('apps.desktop.body')}
        >
          <Button
            appearance="primary"
            icon={<ArrowDownload20Regular />}
            onClick={() => open(DESKTOP_RELEASES_URL)}
          >
            {t('apps.desktop.download')}
          </Button>
        </AppCard>
        <AppCard
          icon={<Code24Regular />}
          title={t('apps.cli.title')}
          body={t('apps.cli.body')}
          extra={
            <>
              {[
                { label: t('apps.cli.unix'), command: CLI_INSTALL_SH },
                { label: t('apps.cli.windows'), command: CLI_INSTALL_PS1 },
              ].map(({ label, command }) => (
                <div key={label} className={styles.command}>
                  <Caption1 className={styles.muted}>{label}</Caption1>
                  <div className={styles.commandRow}>
                    <code className={styles.code}>{command}</code>
                    <Button
                      icon={<Copy20Regular />}
                      aria-label={`${t('apps.cli.copy')}: ${label}`}
                      onClick={() => void copy(command)}
                    />
                  </div>
                </div>
              ))}
            </>
          }
        >
          <Button icon={<ArrowDownload20Regular />} onClick={() => open(CLI_RELEASES_URL)}>
            {t('apps.cli.download')}
          </Button>
        </AppCard>
        <AppCard icon={<Globe24Regular />} title={t('apps.web.title')} body={t('apps.web.body')}>
          <Button appearance="primary" icon={<Open20Regular />} onClick={() => open(webNodeUrl)}>
            {t('apps.web.open')}
          </Button>
          <Button icon={<Share20Regular />} onClick={() => void share()}>
            {t('apps.web.share')}
          </Button>
        </AppCard>
      </div>
    </section>
  );
}
