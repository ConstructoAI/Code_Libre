/**
 * Convert markdown-formatted text to a clean string suitable for the
 * browser's Web Speech API.
 *
 * The renderer in `AiAssistantPage` supports a small markdown subset
 * (`**bold**`, `*italic*`, `` `code` ``, ``` code blocks ```, `- bullet`,
 * `| table | rows |`, `# headings`). Speaking those raw makes the assistant
 * pronounce literal asterisks, pipes, backticks and so on. This util
 * strips the markup while preserving sentence flow so the synthesizer
 * adds the right pauses.
 */
export function markdownToSpeech(input: string): string {
  if (!input) return '';
  let text = input;

  // 1. Strip fenced code blocks entirely — saying every character of code
  //    aloud is useless and noisy.
  text = text.replace(/```[\s\S]*?```/g, ' (extrait de code) ');

  // 2. Strip inline code while keeping the content readable.
  text = text.replace(/`([^`]+)`/g, '$1');

  // 3. Markdown links: `[label](url)` → just the label.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 4. Headings: `# Title` and ATX-closed `## Title ##` → `Title.`
  text = text.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, '$1.');

  // 5. Bold + italic markers.
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // 6. Markdown tables: convert each row of `| a | b | c |` to
  //    `a, b, c.` and drop the `| --- | --- |` separator rows entirely.
  const lines = text.split('\n');
  const cleaned: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      cleaned.push('');
      continue;
    }
    // Separator row: only |, -, : and spaces.
    if (/^\|?[\s\-:|]+\|?$/.test(line) && line.includes('-')) {
      continue;
    }
    // Real markdown table rows have at least 2 pipes AND start+end with `|`
    // (after trim). Sentences that merely contain a pipe like "OR | AND" are
    // left untouched.
    const pipeCount = (line.match(/\|/g) ?? []).length;
    if (line.startsWith('|') && line.endsWith('|') && pipeCount >= 2) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length >= 2) {
        cleaned.push(cells.join(', ') + '.');
        continue;
      }
    }
    cleaned.push(rawLine);
  }
  text = cleaned.join('\n');

  // 7. Bullet markers at line start: `- ` or `* ` → keep the content,
  //    end with `.` so the synthesizer pauses between items.
  text = text.replace(/^[\s]*[-*]\s+(.+)$/gm, (_, item: string) => {
    const trimmed = item.trim();
    return /[.!?,;:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  });

  // 8. Collapse multiple newlines into a sentence boundary so the
  //    synthesizer pauses, but not so much it sounds robotic.
  text = text.replace(/\n{2,}/g, '. ');
  text = text.replace(/\n/g, ' ');

  // 9. Collapse repeated whitespace and stray punctuation. Only strip the
  //    space before `.` and `,` — French typography keeps a space before
  //    `: ; ! ?` and that has no audible TTS impact either way, but the
  //    cleaned text is more readable for debugging.
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\.\s*\./g, '.');
  text = text.replace(/\s+([.,])/g, '$1');

  return text.trim();
}

/**
 * Split long text into smaller chunks (max ~200 chars, sentence-aligned)
 * to work around Chrome's Web Speech API quirk where utterances longer
 * than ~32 KB / ~15 s get truncated or cut off mid-sentence. We chain
 * the chunks via the utterance `onend` event in the hook.
 */
export function splitForSpeech(text: string, maxChunk = 200): string[] {
  if (!text) return [];
  if (text.length <= maxChunk) return [text];

  // Split on sentence boundaries first.
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    if ((buffer + sentence).length > maxChunk && buffer.length > 0) {
      chunks.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  // Safety net: if any single sentence is still longer than maxChunk,
  // hard-split it on word boundaries.
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChunk) {
      finalChunks.push(chunk);
      continue;
    }
    const words = chunk.split(/\s+/);
    let buf = '';
    for (const w of words) {
      if ((buf + ' ' + w).length > maxChunk && buf.length > 0) {
        finalChunks.push(buf.trim());
        buf = w;
      } else {
        buf = buf ? `${buf} ${w}` : w;
      }
    }
    if (buf.trim()) finalChunks.push(buf.trim());
  }

  return finalChunks;
}
