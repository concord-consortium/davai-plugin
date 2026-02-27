/**
 * Replaces spoken voice commands with punctuation characters.
 * Intended to run per-chunk on each SpeechRecognition result transcript.
 */
export function replaceVoiceCommands(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\bperiod$/i, ".")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bquestion mark\b/gi, "?")
    .replace(/\bexclamation point\b/gi, "!")
    .replace(/\bsemicolon\b/gi, ";")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\b(hyphen|dash)\b/gi, "-")
    .replace(/\b(ellipsis|ellipses)\b/gi, "...")
    .replace(/\b(apostrophe|single quotes?)\b/gi, "'")
    .replace(/\b(quotation mark|double quotes?|start quote|end quote|quote)\b/gi, '"')
    .replace(/\b(newline|new line)\b/gi, "\n")
    .replace(/\bnew paragraph\b/gi, "\n\n")
    .replace(/\bsmiley face\b/gi, "😃")
    .replace(/\s+([.?!,;:])/g, "$1")
    .replace(/[ \t]+([-])[ \t]+/g, "$1")
    .replace(/[ \t]+\.\.\./g, "...")
    .replace(/[ \t]+(['])[ \t]+/g, "$1")
    .replace(/(")(\s*[^"]*)(")?/g, (_match, p1, p2, p3) => [p1, p2.trim(), p3 || ""].join(""))
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]+/g, " ");
}

/**
 * Applies formatting heuristics to punctuated text.
 * Ensures spacing after punctuation (.?!,;:), capitalizes the first character
 * and the first letter after sentence-ending punctuation (.?!).
 * Intended to run on the full joined transcript.
 */
export function applyPunctuationHeuristics(text: string): string {
  return text
    .replace(/^[ \t]+|[ \t]+$/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/^\S/, (m) => m.toUpperCase())
    .replace(/([.?!,;:])(\S)/g, (match, punct, nextChar, offset, whole) => {
      const prevChar = offset > 0 ? whole[offset - 1] : "";
      // Preserve decimals and similar numeric formats (e.g., 3.14)
      if (punct === "." && /\d/.test(prevChar) && /\d/.test(nextChar)) {
        return match;
      }
      // Avoid inserting spaces before closing quotes/brackets/ellipsis
      if (/["')\]}…]/.test(nextChar)) {
        return punct + nextChar;
      }
      return `${punct} ${nextChar}`;
    })
    .replace(/([.?!]) (\S)/g, (_match, punct, nextChar) => `${punct} ${nextChar.toUpperCase()}`);
}
