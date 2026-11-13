import { createRemoteJWKSet, jwtVerify } from 'jose';
import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config';

export interface AuthUser {
  subject: string;
  email: string;
  name: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    /** onRequest hook: validates the Dex bearer token and sets request.user from its claims. */
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

export interface TokenClaims {
  sub: string;
  email?: string;
  name?: string;
}
export type VerifyToken = (token: string) => Promise<TokenClaims>;

/** Verifies Dex-issued JWTs against the issuer's JWKS. */
export function createDexVerifier(config: Config): VerifyToken {
  const jwks = createRemoteJWKSet(
    new URL(config.OIDC_JWKS_URL ?? `${config.OIDC_ISSUER.replace(/\/$/, '')}/keys`),
  );
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
    });
    if (!payload.sub) throw new Error('token has no sub');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  };
}

export default fp<{ verify: VerifyToken }>(async (app, { verify }) => {
  app.decorateRequest('user', null);

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw app.httpErrors.unauthorized('Missing bearer token');

    let claims: TokenClaims;
    try {
      claims = await verify(token);
    } catch {
      throw app.httpErrors.unauthorized('Invalid token');
    }

    // Identities live in Dex; nothing is stored here. Memberships reference the lowercased email.
    req.user = {
      subject: claims.sub,
      email: (claims.email ?? `${claims.sub}@unknown`).toLowerCase(),
      name: claims.name ?? null,
    };
  });
});
