import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { isMessageKey, resolveLanguage, translate, type Language } from '../i18n/messages';

declare module 'fastify' {
  interface FastifyRequest {
    /** Language negotiated from `Accept-Language` (`en` or `ro`). */
    lang: Language;
    /** Translates an error message key into the request's language. */
    t(key: string, params?: Record<string, string | number>): string;
  }
}

/** Errors thrown with `withParams(...)` carry the values for the message's `{{placeholders}}`. */
type ParamError = FastifyError & { params?: Record<string, string | number> };

export default fp(async (app) => {
  app.decorateRequest('lang', 'en');
  app.decorateRequest('t', function (this: { lang: Language }, key, params) {
    return translate(this.lang, key, params);
  });
  app.addHook('onRequest', async (req) => {
    req.lang = resolveLanguage(req.headers['accept-language']);
  });
  // Fastify's own error body (`statusCode`, `error`, `message`) stays; only the message is translated.
  app.setErrorHandler((err: ParamError, req, reply) => {
    if (isMessageKey(err.message)) err.message = req.t(err.message, err.params);
    return reply.send(err);
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-language', (reply.request as { lang: Language }).lang);
  });
});
