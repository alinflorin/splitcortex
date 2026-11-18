// Error message catalogues. Routes throw `app.httpErrors.x('errors.someKey')`; the error handler (plugins/i18n.ts)
// translates the key by the request's `Accept-Language`. English is the fallback, and also what an unknown key shows.
export const LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof LANGUAGES)[number];

export const en = {
  'errors.orgNotFound': 'Organisation not found',
  'errors.insufficientRole': 'Insufficient role',
  'errors.missingToken': 'Missing bearer token',
  'errors.invalidToken': 'Invalid token',
  'errors.tooManyRequests': 'Too many requests',
  'errors.invalidNodeCredentials': 'Invalid node credentials',
  'errors.alreadyMember': 'Already a member',
  'errors.memberNotFound': 'Member not found',
  'errors.needsOwner': 'An organisation needs at least one owner',
  'errors.poolNameTaken': 'A pool with this name already exists',
  'errors.poolNotFound': 'Pool not found',
  'errors.expiryInPast': 'The expiry must be in the future',
  'errors.unknownPool': 'Unknown pool',
  'errors.apiKeyNotFound': 'API key not found',
  'errors.slugTaken': 'Slug already taken',
  'errors.storageNotConfigured': 'Model storage is not configured',
  'errors.modelNameTaken': 'A model with this name already exists',
  'errors.modelNotFound': 'Model not found',
  'errors.noUploadInProgress': 'This model has no upload in progress',
  'errors.noSuchPart': 'No such part',
  'errors.partSize': 'This part must be exactly {{expected}} bytes',
  'errors.partContentType': 'Send the part as application/octet-stream',
  'errors.sizeMismatch': 'Uploaded size does not match the announced size',
  'errors.onlyFailedRetry': 'Only failed downloads can be retried',
  'errors.modelNotReady': 'The model is not ready yet',
  'errors.poolServesNoModel': 'The pool serves no model yet',
  'errors.noNodeOnline': 'No node of this pool is online',
  'errors.benchmarkRunning': 'A benchmark of this pool is still running',
  'errors.benchmarkNotFound': 'Benchmark not found',
  'errors.invalidRange': 'Invalid range',
  'errors.codeAllocation': 'Could not allocate a code, try again',
  'errors.enrollmentNotFound': 'Enrollment not found',
  'errors.invalidCode': 'Invalid or expired code',
  'errors.deviceKeyRegistered': 'This device key is already registered',
  'errors.nodeNotFound': 'Node not found',
  'errors.fromBeforeTo': '`from` must be before `to`',
  'errors.rangeLimit': 'Range is limited to {{days}} days',
} as const;

export type MessageKey = keyof typeof en;

export const ro: Record<MessageKey, string> = {
  'errors.orgNotFound': 'Organizația nu a fost găsită',
  'errors.insufficientRole': 'Rol insuficient',
  'errors.missingToken': 'Lipsește token-ul bearer',
  'errors.invalidToken': 'Token invalid',
  'errors.tooManyRequests': 'Prea multe cereri',
  'errors.invalidNodeCredentials': 'Credențiale de nod invalide',
  'errors.alreadyMember': 'Este deja membru',
  'errors.memberNotFound': 'Membrul nu a fost găsit',
  'errors.needsOwner': 'O organizație are nevoie de cel puțin un proprietar',
  'errors.poolNameTaken': 'Există deja un pool cu acest nume',
  'errors.poolNotFound': 'Pool-ul nu a fost găsit',
  'errors.expiryInPast': 'Data de expirare trebuie să fie în viitor',
  'errors.unknownPool': 'Pool necunoscut',
  'errors.apiKeyNotFound': 'Cheia API nu a fost găsită',
  'errors.slugTaken': 'Slug-ul este deja folosit',
  'errors.storageNotConfigured': 'Stocarea modelelor nu este configurată',
  'errors.modelNameTaken': 'Există deja un model cu acest nume',
  'errors.modelNotFound': 'Modelul nu a fost găsit',
  'errors.noUploadInProgress': 'Acest model nu are o încărcare în curs',
  'errors.noSuchPart': 'Nu există o astfel de parte',
  'errors.partSize': 'Această parte trebuie să aibă exact {{expected}} octeți',
  'errors.partContentType': 'Trimite partea ca application/octet-stream',
  'errors.sizeMismatch': 'Dimensiunea încărcată nu corespunde cu cea anunțată',
  'errors.onlyFailedRetry': 'Doar descărcările eșuate pot fi reîncercate',
  'errors.modelNotReady': 'Modelul nu este încă gata',
  'errors.poolServesNoModel': 'Pool-ul nu servește încă niciun model',
  'errors.noNodeOnline': 'Niciun nod din acest pool nu este online',
  'errors.benchmarkRunning': 'Un benchmark al acestui pool încă rulează',
  'errors.benchmarkNotFound': 'Benchmark-ul nu a fost găsit',
  'errors.invalidRange': 'Interval invalid',
  'errors.codeAllocation': 'Nu s-a putut aloca un cod, încearcă din nou',
  'errors.enrollmentNotFound': 'Înrolarea nu a fost găsită',
  'errors.invalidCode': 'Cod invalid sau expirat',
  'errors.deviceKeyRegistered': 'Această cheie de dispozitiv este deja înregistrată',
  'errors.nodeNotFound': 'Nodul nu a fost găsit',
  'errors.fromBeforeTo': '`from` trebuie să fie înainte de `to`',
  'errors.rangeLimit': 'Intervalul este limitat la {{days}} zile',
};

const catalogues: Record<Language, Record<string, string>> = { en, ro };

/** Picks the best supported language from an `Accept-Language` header (q-values honoured; `en` when nothing matches). */
export function resolveLanguage(header: string | undefined): Language {
  if (!header) return 'en';
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q) : 1, index };
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { lang } of ranked) {
    if ((LANGUAGES as readonly string[]).includes(lang!)) return lang as Language;
  }
  return 'en';
}

export function isMessageKey(key: string): key is MessageKey {
  return key in en;
}

/** Translates `key` (a key that is not in the catalogue is returned untouched) and fills `{{param}}` placeholders. */
export function translate(
  lang: Language,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = catalogues[lang][key] ?? en[key as MessageKey];
  if (template === undefined) return key;
  return template.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}
