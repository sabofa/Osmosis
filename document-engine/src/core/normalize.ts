// Authored text is stored NFC-normalized.
export function toNfc(text: string): string {
  return text.normalize('NFC')
}

export function isNfc(text: string): boolean {
  return text.normalize('NFC') === text
}
