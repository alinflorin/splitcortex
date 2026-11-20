/**
 * Set while the user signs out from a private page. Navigating home is a low priority router transition, while
 * dropping the user is an urgent state change: the private page renders signed out first, and without this it would
 * send the user to Dex instead of home.
 */
let from: string | null = null;

export function startSignOut(path: string) {
  from = path;
  // Safety net: never block a later visit to the same page.
  setTimeout(() => {
    from = null;
  }, 3000);
}

export const isSigningOut = (path: string) => from === path;
export const endSignOut = () => {
  from = null;
};
