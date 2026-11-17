import {
  Body1,
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  Textarea,
  Title1,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { Delete20Regular, Send20Filled, Stop20Filled } from '@fluentui/react-icons';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { z } from 'zod';
import { listModels, streamChat, type ChatMessage, type ChatStats } from '../lib/chatStream';
import { getPlaygroundBaseUrl } from '../lib/gateway';

// Messages are i18n keys; they are translated where they are rendered. Numbers are free text, empty = the default.
const optionalNumber = (min: number, max: number, integer: boolean) =>
  z
    .string()
    .trim()
    .refine(
      (v) => {
        if (v === '') return true;
        const n = Number(v);
        return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
      },
      { error: 'validation.numberRange' },
    );

const schema = z.object({
  key: z.string().trim().min(1, { error: 'validation.required' }),
  model: z.string(),
  system: z.string(),
  temperature: optionalNumber(0, 2, false),
  maxTokens: optionalNumber(1, 131072, true),
});
type PlaygroundForm = z.infer<typeof schema>;

interface Turn extends ChatMessage {
  stats?: ChatStats;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '880px',
  },
  muted: { color: tokens.colorNeutralForeground2 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  row: {
    display: 'grid',
    gap: tokens.spacingHorizontalM,
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  },
  keyRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  grow: { flexGrow: 1, minWidth: '220px' },
  thread: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  turn: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    overflowWrap: 'anywhere',
  },
  user: { backgroundColor: tokens.colorNeutralBackground2 },
  assistant: { backgroundColor: tokens.colorNeutralBackground1 },
  who: {
    color: tokens.colorNeutralForeground3,
    display: 'block',
    marginBottom: tokens.spacingVerticalXS,
  },
  plain: { whiteSpace: 'pre-wrap' },
  markdown: {
    '& p': { marginTop: 0, marginBottom: tokens.spacingVerticalS },
    '& pre': {
      overflowX: 'auto',
      padding: tokens.spacingVerticalS,
      borderRadius: tokens.borderRadiusMedium,
      backgroundColor: tokens.colorNeutralBackground3,
    },
    '& code': { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
    '& > :last-child': { marginBottom: 0 },
  },
  composer: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'flex-end' },
  textarea: { flexGrow: 1 },
});

const statsLine = (s: ChatStats, t: TFunction) => {
  const parts: string[] = [];
  if (s.firstTokenMs !== null)
    parts.push(t('playground.firstToken', { ms: Math.round(s.firstTokenMs) }));
  if (s.tokens > 0 && s.totalMs > 0) {
    const gen = s.totalMs - (s.firstTokenMs ?? 0);
    const rate = gen > 0 ? (s.tokens / gen) * 1000 : 0;
    parts.push(t('playground.tokens', { count: s.tokens }));
    if (rate > 0) parts.push(t('playground.rate', { rate: rate.toFixed(1) }));
  }
  return parts.join(' · ');
};

/**
 * Chat with a pool through the gateway, from the browser. The API key is pasted by the user and lives only in this
 * component's state; the conversation is not stored anywhere (a refresh clears it) and is resent in full on every turn.
 */
export function Playground() {
  const styles = useStyles();
  const { t } = useTranslation();
  const baseUrl = getPlaygroundBaseUrl();

  const form = useForm<PlaygroundForm>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { key: '', model: '', system: '', temperature: '', maxTokens: '' },
  });
  const [models, setModels] = useState<string[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Leaving the page stops a running request, so the node is freed.
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const connect = form.handleSubmit(async ({ key }) => {
    setConnecting(true);
    setError(null);
    try {
      const list = (await listModels(baseUrl, key)).map((m) => m.id);
      setModels(list);
      form.setValue('model', list[0] ?? '');
    } catch (e) {
      setModels(null);
      setError(e instanceof Error ? e.message : t('playground.failed'));
    } finally {
      setConnecting(false);
    }
  });

  const send = async () => {
    const text = draft.trim();
    const values = form.getValues();
    if (!text || busy || !values.model || !(await form.trigger(['temperature', 'maxTokens'])))
      return;

    const history: ChatMessage[] = [
      ...(values.system.trim() ? [{ role: 'system' as const, content: values.system.trim() }] : []),
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ];
    setTurns((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ]);
    setDraft('');
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const stats = await streamChat(
        baseUrl,
        values.key.trim(),
        {
          model: values.model,
          messages: history,
          temperature: values.temperature === '' ? undefined : Number(values.temperature),
          maxTokens: values.maxTokens === '' ? undefined : Number(values.maxTokens),
        },
        (delta) =>
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            return last ? [...prev.slice(0, -1), { ...last, content: last.content + delta }] : prev;
          }),
        controller.signal,
      );
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        return last ? [...prev.slice(0, -1), { ...last, stats }] : prev;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('playground.failed'));
      // Drop an assistant turn that never received anything.
      setTurns((prev) => (prev[prev.length - 1]?.content === '' ? prev.slice(0, -1) : prev));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const errors = form.formState.errors;

  return (
    <div className={styles.root}>
      <div>
        <Title1>{t('playground.title')}</Title1>
        <Body1 className={styles.muted} block>
          {t('playground.subtitle')}
        </Body1>
      </div>

      <section className={styles.card}>
        <form onSubmit={(e) => void connect(e)} className={styles.keyRow}>
          <Controller
            name="key"
            control={form.control}
            render={({ field }) => (
              <Field
                label={t('playground.key')}
                hint={t('playground.keyHint')}
                className={styles.grow}
                validationMessage={errors.key?.message && t(errors.key.message)}
              >
                <Input {...field} type="password" autoComplete="off" disabled={busy} />
              </Field>
            )}
          />
          <Button type="submit" appearance="primary" disabled={connecting || busy}>
            {t(models ? 'playground.reconnect' : 'playground.connect')}
          </Button>
        </form>

        {models && models.length === 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>{t('playground.noModels')}</MessageBarBody>
          </MessageBar>
        )}

        {models && models.length > 0 && (
          <>
            <div className={styles.row}>
              <Controller
                name="model"
                control={form.control}
                render={({ field }) => (
                  <Field label={t('playground.model')}>
                    <Select
                      value={field.value}
                      onChange={(_, d) => field.onChange(d.value)}
                      disabled={busy}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              />
              <Controller
                name="temperature"
                control={form.control}
                render={({ field }) => (
                  <Field
                    label={t('playground.temperature')}
                    validationMessage={
                      errors.temperature?.message &&
                      t(errors.temperature.message, { min: 0, max: 2 })
                    }
                  >
                    <Input {...field} inputMode="decimal" placeholder={t('playground.default')} />
                  </Field>
                )}
              />
              <Controller
                name="maxTokens"
                control={form.control}
                render={({ field }) => (
                  <Field
                    label={t('playground.maxTokens')}
                    validationMessage={
                      errors.maxTokens?.message &&
                      t(errors.maxTokens.message, { min: 1, max: 131072 })
                    }
                  >
                    <Input {...field} inputMode="numeric" placeholder={t('playground.default')} />
                  </Field>
                )}
              />
            </div>
            <Controller
              name="system"
              control={form.control}
              render={({ field }) => (
                <Field label={t('playground.system')}>
                  <Textarea {...field} resize="vertical" rows={2} disabled={busy} />
                </Field>
              )}
            />
          </>
        )}
      </section>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {models && models.length > 0 && (
        <>
          <div className={styles.thread} aria-live="polite">
            {turns.map((turn, i) => (
              <article
                key={i}
                className={`${styles.turn} ${turn.role === 'user' ? styles.user : styles.assistant}`}
              >
                <Caption1 className={styles.who}>
                  {t(turn.role === 'user' ? 'playground.you' : 'playground.assistant')}
                </Caption1>
                {turn.role === 'user' ? (
                  <Text className={styles.plain}>{turn.content}</Text>
                ) : (
                  <div className={styles.markdown}>
                    <Markdown>{turn.content}</Markdown>
                  </div>
                )}
                {turn.stats && statsLine(turn.stats, t) && (
                  <Caption1 className={styles.muted} block>
                    {statsLine(turn.stats, t)}
                  </Caption1>
                )}
              </article>
            ))}
            <div ref={end} />
          </div>

          <div className={styles.composer}>
            <Textarea
              className={styles.textarea}
              aria-label={t('playground.message')}
              placeholder={t('playground.placeholder')}
              value={draft}
              onChange={(_, d) => setDraft(d.value)}
              onKeyDown={onKeyDown}
              resize="vertical"
              rows={2}
            />
            {busy ? (
              <Button icon={<Stop20Filled />} onClick={() => abort.current?.abort()}>
                {t('playground.stop')}
              </Button>
            ) : (
              <Button
                appearance="primary"
                icon={<Send20Filled />}
                disabled={!draft.trim()}
                onClick={() => void send()}
              >
                {t('playground.send')}
              </Button>
            )}
            <Button
              icon={<Delete20Regular />}
              aria-label={t('playground.clear')}
              disabled={busy || turns.length === 0}
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
