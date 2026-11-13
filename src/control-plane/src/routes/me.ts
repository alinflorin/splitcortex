import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorSchema, UserSchema } from '../dto';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['users'],
        summary: 'The signed-in user (from the token claims)',
        security: [{ dex: [] }, { bearer: [] }],
        response: { 200: UserSchema, 401: ErrorSchema },
      },
    },
    async (req) => req.user!,
  );
};
