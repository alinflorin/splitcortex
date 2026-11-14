import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client';
import auth, { type VerifyToken } from './plugins/auth';
import { memberRoutes } from './routes/members';
import { meRoutes } from './routes/me';
import { organisationRoutes } from './routes/organisations';
import { poolRoutes } from './routes/pools';
import { usageRoutes } from './routes/usage';

export interface AppDeps {
  db: Db;
  verify: VerifyToken;
  /** Dex issuer (browser-reachable URL) and the public client Swagger UI signs in with (code + PKCE). */
  oidc?: { issuer: string; clientId: string };
  logLevel?: string;
}

/** Everything public lives under /api (the ingress routes `/api` to this service without stripping it). */
export const API_PREFIX = '/api';

const OIDC_FALLBACK = { issuer: 'http://localhost:5556', clientId: 'splitcortex-ui' };

export async function buildApp({ db, verify, oidc = OIDC_FALLBACK, logLevel = 'info' }: AppDeps) {
  const app = Fastify({ logger: { level: logLevel } }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const issuer = oidc.issuer.replace(/\/$/, '');

  await app.register(sensible);
  await app.register(swagger, {
    openapi: {
      info: { title: 'SplitCortex control plane API', version: '0.0.0' },
      components: {
        securitySchemes: {
          // "Authorize" in Swagger UI signs in through Dex (authorization code + PKCE, public client).
          dex: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: `${issuer}/auth`,
                tokenUrl: `${issuer}/token`,
                scopes: { openid: 'OpenID', email: 'Email', profile: 'Profile' },
              },
            },
          },
          // Or paste a token manually.
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: `${API_PREFIX}/docs`,
    // Redirect URI to register in Dex: <origin>/api/docs/static/oauth2-redirect.html
    initOAuth: {
      clientId: oidc.clientId,
      scopes: ['openid', 'email', 'profile'],
      usePkceWithAuthorizationCodeGrant: true,
    },
  });
  await app.register(auth, { verify });

  // Probes (not exposed through the ingress).
  app.get('/healthz', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/readyz', { schema: { hide: true } }, async () => {
    await db.execute(sql`select 1`);
    return { status: 'ok' };
  });

  await app.register(
    async (api) => {
      await api.register(meRoutes);
      await api.register(organisationRoutes, { db });
      await api.register(memberRoutes, { db });
      await api.register(poolRoutes, { db });
      await api.register(usageRoutes, { db });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
