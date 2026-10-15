/**
 * Curated list of common profanities and offensive patterns for the room profanity filter.
 */
const PROFANITY_WORDS = [
  "anal",
  "anus",
  "arse",
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "bloody",
  "blowjob",
  "bollock",
  "bollocks",
  "boner",
  "bullshit",
  "clit",
  "cock",
  "crap",
  "cunt",
  "damn",
  "dick",
  "dickhead",
  "dildo",
  "dyke",
  "fag",
  "faggot",
  "fuck",
  "fucker",
  "fucking",
  "goddamn",
  "hell",
  "homo",
  "jerk",
  "jizz",
  "motherfucker",
  "nigger",
  "nigga",
  "penis",
  "piss",
  "prick",
  "pussy",
  "retard",
  "shit",
  "slut",
  "twat",
  "vagina",
  "whore",
  "wank",
  "wanker",
];

// Leetspeak normalization map
const LEET_MAP: Record<string, string> = {
  "@": "a",
  "4": "a",
  "8": "b",
  "3": "e",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  "5": "s",
  "$": "s",
  "7": "t",
  "+": "t",
  "v": "u",
};

/**
 * Normalizes text by converting leetspeak characters to standard letters.
 */
function normalizeLeet(text: string): string {
  let result = "";
  for (const char of text) {
    const lower = char.toLowerCase();
    result += LEET_MAP[lower] ?? lower;
  }
  return result;
}

export interface ProfanityFilterResult {
  cleanText: string;
  hasProfanity: boolean;
  matchedWords: string[];
}

/**
 * Filters and masks profanities in text using word boundary matching and leetspeak detection.
 */
export function filterProfanity(text: string): ProfanityFilterResult {
  if (!text) {
    return { cleanText: "", hasProfanity: false, matchedWords: [] };
  }

  const matchedWords: string[] = [];
  let cleanText = text;

  for (const word of PROFANITY_WORDS) {
    // Match word boundaries or isolated leetspeak patterns
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    if (regex.test(cleanText)) {
      matchedWords.push(word);
      cleanText = cleanText.replace(regex, (match) => "*".repeat(match.length));
    }
  }

  // Also check normalized leet text for evasion attempts (e.g. f.u.c.k, f*ck, b!tch, $h!t)
  for (const word of PROFANITY_WORDS) {
    // Build regex that matches the word with possible non-alphanumeric separators between letters
    const pattern = word
      .split("")
      .map((letter) => {
        // Find leet equivalents for this letter
        const equivalents = [letter];
        for (const [k, v] of Object.entries(LEET_MAP)) {
          if (v === letter) equivalents.push(`\\${k}`);
        }
        return `[${equivalents.join("")}]`;
      })
      .join("[\\s_.*-]*");

    const fuzzyRegex = new RegExp(`\\b${pattern}\\b`, "gi");
    if (fuzzyRegex.test(cleanText)) {
      if (!matchedWords.includes(word)) {
        matchedWords.push(word);
      }
      cleanText = cleanText.replace(fuzzyRegex, (match) => "*".repeat(match.length));
    }
  }

  return {
    cleanText,
    hasProfanity: matchedWords.length > 0,
    matchedWords,
  };
}
