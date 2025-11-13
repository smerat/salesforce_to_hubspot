/**
 * Convert Salesforce 15-character ID to 18-character ID
 *
 * Salesforce has two ID formats:
 * - 15-character (case-sensitive)
 * - 18-character (case-insensitive, with checksum suffix)
 *
 * This function converts 15-char IDs to 18-char IDs by calculating the checksum.
 * If the ID is already 18 characters, it returns it unchanged.
 */
export function convertTo18CharId(id15: string): string {
  if (!id15) return id15;

  // If already 18 characters, return as-is
  if (id15.length === 18) return id15;

  // If not 15 characters, return as-is (invalid ID)
  if (id15.length !== 15) return id15;

  // Calculate the 3-character checksum suffix
  let suffix = '';

  for (let i = 0; i < 3; i++) {
    let flags = 0;

    for (let j = 0; j < 5; j++) {
      const c = id15.charAt(i * 5 + j);

      // Check if character is uppercase (A-Z)
      if (c >= 'A' && c <= 'Z') {
        flags += 1 << j;
      }
    }

    // Convert flags (0-31) to base32 character
    if (flags <= 25) {
      suffix += String.fromCharCode('A'.charCodeAt(0) + flags);
    } else {
      suffix += String.fromCharCode('0'.charCodeAt(0) + (flags - 26));
    }
  }

  return id15 + suffix;
}

/**
 * Convert a set of Salesforce IDs to 18-character format
 */
export function convertIdsTo18Char(ids: string[]): string[] {
  return ids.map(id => convertTo18CharId(id));
}
