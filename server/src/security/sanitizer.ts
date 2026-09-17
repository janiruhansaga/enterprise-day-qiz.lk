// List of common offensive patterns and profanities for school safety
const DISALLOWED_KEYWORDS = [
  'admin',
  'root',
  'teacher',
  'moderator',
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'dick',
  'pussy',
  'nazi',
  'hitler',
  'nigger',
  'faggot',
  'whore',
  'slut'
];

/**
 * Validates whether a nickname is appropriate for a school classroom environment.
 * Rejects offensive words, profanity, and impersonation keywords ('admin', 'teacher').
 */
export function isAppropriateNickname(nickname: string): { valid: boolean; reason?: string } {
  const normalized = nickname.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const word of DISALLOWED_KEYWORDS) {
    if (normalized.includes(word)) {
      return {
        valid: false,
        reason: 'Nickname contains disallowed, offensive, or reserved words'
      };
    }
  }

  return { valid: true };
}
