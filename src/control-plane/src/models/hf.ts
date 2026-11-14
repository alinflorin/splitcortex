/** Hosts a Hugging Face download may touch, including redirects (files are served from the xet / LFS CDNs). */
export function isAllowedHfHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'huggingface.co' || h.endsWith('.huggingface.co') || h === 'hf.co' || h.endsWith('.hf.co')
  );
}

/**
 * `https://huggingface.co/<org>/<repo>/blob/<rev>/<path>` is the page URL; the file itself is at `/resolve/`.
 * Accept both, drop the query and fragment, and return the `/resolve/` form.
 */
export function normaliseHuggingFaceUrl(raw: string): string {
  const url = new URL(raw);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, '$1/resolve/');
  return url.toString();
}

export const fileNameFromUrl = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'model');
