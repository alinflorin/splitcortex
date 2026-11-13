import { z } from 'zod';

/** The signed-in user, taken from the Dex token claims (there is no users table). */
export const UserSchema = z.object({
  subject: z.string(),
  email: z.string(),
  name: z.string().nullable(),
});
export type UserDto = z.infer<typeof UserSchema>;
