import { useAuth } from 'react-oidc-context';

export interface CurrentUser {
  name: string;
  email: string | undefined;
}

export function useCurrentUser(): CurrentUser | null {
  const { user } = useAuth();
  if (!user) return null;
  const email = user.profile.email;
  return { name: user.profile.name ?? email ?? user.profile.sub, email };
}
