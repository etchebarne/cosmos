/**
 * Convert an OS file path to an LSP-compatible file:// URI.
 * Handles Windows backslashes and drive letters.
 */
export function pathToFileUri(path: string): string {
  // Normalize backslashes to forward slashes
  let normalized = path.replace(/\\/g, "/");

  // Ensure drive letter is lowercase for consistency
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }

  // file:///c:/Users/... (three slashes for absolute paths)
  return `file:///${normalized}`;
}

/**
 * Convert an LSP file:// URI back to an OS path.
 */
export function fileUriToPath(uri: string): string {
  let path = uri.replace("file:///", "");
  path = decodeURIComponent(path);

  // On Windows, restore backslashes
  if (/^[a-zA-Z]:/.test(path)) {
    path = path.replace(/\//g, "\\");
  }

  return path;
}
