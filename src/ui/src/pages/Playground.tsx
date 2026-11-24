import {
  Button,
  Caption1,
  Field,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Attach20Regular,
  Delete20Regular,
  Dismiss16Regular,
  Document20Regular,
  Mic20Regular,
  Record20Filled,
  Send20Filled,
  Stop20Filled,
} from '@fluentui/react-icons';
import type { TFunction } from 'i18next';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { Controller, useForm } from 'react-hook-form';
import { PageHeader } from '../components/layout/PageHeader';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { z } from 'zod';
import {
  AttachmentError,
  DEFAULT_MAX_MEDIA_BYTES,
  buildContent,
  mediaBytes,
  startRecording,
  toAttachment,
  type Attachment,
} from '../lib/attachments';
import {
  listModels,
  streamChat,
  type ChatMessage,
  type ChatStats,
  type GatewayModel,
} from '../lib/chatStream';
import { getPlaygroundBaseUrl } from '../lib/gateway';
import { GLASS } from '../theme/glass';

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

/** A turn as shown: the text the user typed (or the reply) and what was attached to it. */
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  stats?: ChatStats;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  muted: { color: tokens.colorNeutralForeground2 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    ...GLASS.panel,
  },
  row: {
    display: 'grid',
    gap: tokens.spacingHorizontalM,
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  },
  keyForm: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  keyRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  grow: { flexGrow: 1, minWidth: '220px' },
  thread: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  turn: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    overflowWrap: 'anywhere',
  },
  user: { ...GLASS.well },
  assistant: { ...GLASS.panel },
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
      ...GLASS.well,
    },
    '& code': { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
    '& > :last-child': { marginBottom: 0 },
  },
  composer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
    alignItems: 'flex-end',
  },
  composerBox: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  dropping: {
    outline: `2px dashed ${tokens.colorBrandStroke1}`,
    outlineOffset: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusXLarge,
  },
  // A basis of its own and no minimum width: in a narrow window the buttons wrap below instead of pushing the
  // field past the edge.
  textarea: { flex: '1 1 220px', minWidth: 0 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    maxWidth: '100%',
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusLarge,
    ...GLASS.well,
  },
  chipName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '200px',
  },
  thumb: {
    height: '28px',
    width: '28px',
    objectFit: 'cover',
    borderRadius: tokens.borderRadiusMedium,
  },
  media: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalS,
    alignItems: 'center',
  },
  image: {
    maxHeight: '220px',
    maxWidth: '100%',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  audio: { maxWidth: '100%' },
  hidden: { display: 'none' },
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

/** An attachment of a sent message: the image, an audio player, or the file's name. */
function AttachmentView({ attachment: a }: { attachment: Attachment }) {
  const styles = useStyles();
  if (a.kind === 'image' && a.dataUrl)
    return <img className={styles.image} src={a.dataUrl} alt={a.name} />;
  if (a.kind === 'audio' && a.dataUrl)
    return <audio className={styles.audio} controls src={a.dataUrl} aria-label={a.name} />;
  return (
    <span className={styles.chip}>
      <Document20Regular />
      <Caption1 className={styles.chipName} title={a.name}>
        {a.name}
      </Caption1>
    </span>
  );
}

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
  const [models, setModels] = useState<GatewayModel[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState<Awaited<ReturnType<typeof startRecording>> | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // What the gateway takes per request (it reports it with the models); the whole conversation is resent each turn.
  const mediaLimit =
    models?.find((m) => m.max_media_bytes)?.max_media_bytes ?? DEFAULT_MAX_MEDIA_BYTES;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Leaving the page stops a running request, so the node is freed.
  useEffect(() => () => abort.current?.abort(), []);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  useEffect(() => () => recordingRef.current?.cancel(), []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const connect = form.handleSubmit(async ({ key }) => {
    setConnecting(true);
    setError(null);
    try {
      const list = await listModels(baseUrl, key);
      setModels(list);
      form.setValue('model', list[0]?.id ?? '');
    } catch (e) {
      setModels(null);
      setError(e instanceof Error ? e.message : t('playground.failed'));
    } finally {
      setConnecting(false);
    }
  });

  const send = async () => {
    const text = draft.trim();
    const sent = attachments;
    const values = form.getValues();
    if (
      (!text && sent.length === 0) ||
      busy ||
      recording ||
      !values.model ||
      !(await form.trigger(['temperature', 'maxTokens']))
    )
      return;
    // The gateway caps the media of one request; the whole conversation is resent every turn.
    if (mediaBytes([...turns.flatMap((t) => t.attachments ?? []), ...sent]) > mediaLimit) {
      setError(
        t('playground.attach.total', { limit: `${Math.round(mediaLimit / 1024 / 1024)} MiB` }),
      );
      return;
    }

    const history: ChatMessage[] = [
      ...(values.system.trim() ? [{ role: 'system' as const, content: values.system.trim() }] : []),
      ...turns.map(({ role, content, attachments: files }) => ({
        role,
        content: role === 'user' ? buildContent(content, files) : content,
      })),
      { role: 'user', content: buildContent(text, sent) },
    ];
    setTurns((prev) => [
      ...prev,
      { role: 'user', content: text, attachments: sent },
      { role: 'assistant', content: '' },
    ]);
    setDraft('');
    setAttachments([]);
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

  const addFiles = async (files: Iterable<File>) => {
    const added: Attachment[] = [];
    let failure: string | null = null;
    for (const file of files) {
      try {
        added.push(await toAttachment(file, mediaLimit));
      } catch (e) {
        failure =
          e instanceof AttachmentError
            ? t(`playground.attach.${e.code}`, { name: e.file, limit: e.detail })
            : t('playground.failed');
      }
    }
    if (added.length > 0) setAttachments((prev) => [...prev, ...added]);
    setError(failure);
  };

  const toggleRecording = async () => {
    if (recording) {
      const rec = recording;
      setRecording(null);
      await addFiles([await rec.stop()]);
      return;
    }
    try {
      setRecording(await startRecording());
      setError(null);
    } catch {
      setError(t('playground.attach.noMic'));
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length === 0) return;
    e.preventDefault();
    void addFiles([...e.clipboardData.files]);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles([...e.dataTransfer.files]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const errors = form.formState.errors;

  // Warn when the conversation holds media the selected model's nodes do not report accepting (the gateway then
  // answers 400). Unknown capabilities (an older gateway) warn about nothing.
  const accepted = models?.find((m) => m.id === form.watch('model'))?.input_modalities;
  const missing = accepted
    ? (['image', 'audio'] as const).filter(
        (kind) =>
          !accepted.includes(kind) &&
          [...turns.flatMap((x) => x.attachments ?? []), ...attachments].some(
            (a) => a.kind === kind,
          ),
      )
    : [];

  return (
    <div className={styles.root}>
      <PageHeader title={t('playground.title')} subtitle={t('playground.subtitle')} />

      <section className={styles.card}>
        <form onSubmit={(e) => void connect(e)} className={styles.keyForm}>
          <Label htmlFor="playground-key">{t('playground.key')}</Label>
          <div className={styles.keyRow}>
            <Controller
              name="key"
              control={form.control}
              render={({ field }) => (
                <Field
                  hint={t('playground.keyHint')}
                  className={styles.grow}
                  validationMessage={errors.key?.message && t(errors.key.message)}
                >
                  <Input
                    {...field}
                    id="playground-key"
                    type="password"
                    autoComplete="off"
                    disabled={busy}
                  />
                </Field>
              )}
            />
            <Button type="submit" appearance="primary" disabled={connecting || busy}>
              {t(models ? 'playground.reconnect' : 'playground.connect')}
            </Button>
          </div>
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
                        <option key={m.id} value={m.id}>
                          {m.id}
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
                  <>
                    {turn.content && <Text className={styles.plain}>{turn.content}</Text>}
                    {turn.attachments && turn.attachments.length > 0 && (
                      <div className={styles.media}>
                        {turn.attachments.map((a) => (
                          <AttachmentView key={a.id} attachment={a} />
                        ))}
                      </div>
                    )}
                  </>
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

          {missing.length > 0 && (
            <MessageBar intent="warning">
              <MessageBarBody>
                {t('playground.attach.modalityMissing', { kind: missing.join(', ') })}
              </MessageBarBody>
            </MessageBar>
          )}

          <div
            className={`${styles.composerBox} ${dragging ? styles.dropping : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {attachments.length > 0 && (
              <div className={styles.chips}>
                {attachments.map((a) => (
                  <span key={a.id} className={styles.chip}>
                    {a.kind === 'image' && a.dataUrl ? (
                      <img className={styles.thumb} src={a.dataUrl} alt="" />
                    ) : a.kind === 'audio' ? (
                      <Mic20Regular />
                    ) : (
                      <Document20Regular />
                    )}
                    <Caption1 className={styles.chipName} title={a.name}>
                      {a.name}
                    </Caption1>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<Dismiss16Regular />}
                      aria-label={t('playground.attach.remove', { name: a.name })}
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    />
                  </span>
                ))}
              </div>
            )}
            <div className={styles.composer}>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                data-testid="attachment-input"
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <Button
                icon={<Attach20Regular />}
                aria-label={t('playground.attach.add')}
                title={t('playground.attach.hint')}
                disabled={busy}
                onClick={() => picker.current?.click()}
              />
              <Button
                icon={recording ? <Record20Filled /> : <Mic20Regular />}
                aria-label={t(
                  recording ? 'playground.attach.stopRecording' : 'playground.attach.record',
                )}
                appearance={recording ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void toggleRecording()}
              />
              <Textarea
                className={styles.textarea}
                aria-label={t('playground.message')}
                placeholder={t('playground.placeholder')}
                value={draft}
                onChange={(_, d) => setDraft(d.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
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
                  disabled={(!draft.trim() && attachments.length === 0) || recording !== null}
                  onClick={() => void send()}
                >
                  {t('playground.send')}
                </Button>
              )}
              <Button
                icon={<Delete20Regular />}
                aria-label={t('playground.clear')}
                disabled={busy || (turns.length === 0 && attachments.length === 0)}
                onClick={() => {
                  setTurns([]);
                  setAttachments([]);
                  setError(null);
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
