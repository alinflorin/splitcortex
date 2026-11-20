/** Offers a Blob to the user as a file download (no navigation). */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // the click starts the download synchronously; release the memory a moment later
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
