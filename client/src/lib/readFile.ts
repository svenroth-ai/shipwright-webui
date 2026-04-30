/**
 * Read a `File` object as a UTF-8 string.
 *
 * We prefer `Blob.prototype.text()` when available (one-liner) and fall
 * back to `FileReader.readAsText` because the jsdom shipped with this
 * project's vitest does NOT implement `Blob.prototype.text` — calling it
 * directly throws `TypeError: file.text is not a function` in tests
 * (captured during iterate-20260430-actions-upload-ui).
 *
 * Both ActionsConfigCard (Settings) and ProjectWizard (Advanced step)
 * share this helper so the upload code paths read identical bytes.
 */
export function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader produced non-string result"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader error"));
    reader.readAsText(file);
  });
}
