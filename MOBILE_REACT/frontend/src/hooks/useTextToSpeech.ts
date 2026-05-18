/**
 * useTextToSpeech — wrapper around the browser's Web Speech API
 * (window.speechSynthesis) for the mobile AI assistant.
 *
 * Features:
 *   - Per-message tracking via a `speakingId` so the calling component
 *     can render a "stop" icon on the message currently being read.
 *   - Automatic French voice selection: prefers fr-CA, falls back to
 *     fr-FR, then any French locale, else the system default.
 *   - Long-text chunking via splitForSpeech() to work around Chrome's
 *     ~15 s truncation bug on long utterances.
 *   - Cleanup on unmount: cancels any in-flight speech.
 *
 * Browser support: Chrome (Android + desktop), Edge, Safari, Firefox.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { markdownToSpeech, splitForSpeech } from '@/utils/markdownToSpeech';

interface UseTextToSpeechOptions {
  /** BCP-47 language code for voice selection. Default 'fr-CA'. */
  lang?: string;
  /** Speech rate (0.1–10). Default 1.0. */
  rate?: number;
  /** Speech pitch (0–2). Default 1.0. */
  pitch?: number;
}

export interface UseTextToSpeechReturn {
  /** Start speaking `text`. If `id` is provided, expose it via `speakingId`. */
  speak: (text: string, id?: string | number) => void;
  /** Cancel any current and queued utterances. */
  stop: () => void;
  /** True while the synthesizer is actively producing audio. */
  isSpeaking: boolean;
  /** ID of the message currently being read, or null if idle / not tracked. */
  speakingId: string | number | null;
  /** True if the browser supports speechSynthesis. */
  isSupported: boolean;
}

function pickFrenchVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const exact = voices.find((v) => v.lang.toLowerCase() === 'fr-ca');
  if (exact) return exact;
  const fr = voices.find((v) => v.lang.toLowerCase() === 'fr-fr');
  if (fr) return fr;
  const anyFrench = voices.find((v) => v.lang.toLowerCase().startsWith('fr'));
  if (anyFrench) return anyFrench;
  return null;
}

export function useTextToSpeech(
  options: UseTextToSpeechOptions = {},
): UseTextToSpeechReturn {
  const { lang = 'fr-CA', rate = 1.0, pitch = 1.0 } = options;
  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | number | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const queueRef = useRef<SpeechSynthesisUtterance[]>([]);
  const currentIdRef = useRef<string | number | null>(null);
  // Monotone token: each speak() bumps it, stale handlers (delivered after a
  // newer speak() already started) bail out by comparing their captured token.
  // Comparing captured user-supplied `id` is not airtight because the caller
  // can re-speak the same id back-to-back.
  const tokenRef = useRef(0);

  // Voices populate asynchronously on Chrome — listen to voiceschanged.
  useEffect(() => {
    if (!isSupported) return;
    const synth = window.speechSynthesis;
    const updateVoices = () => {
      voicesRef.current = synth.getVoices();
    };
    updateVoices();
    synth.addEventListener('voiceschanged', updateVoices);
    return () => synth.removeEventListener('voiceschanged', updateVoices);
  }, [isSupported]);

  // Cancel any in-flight speech on unmount so navigating away kills audio.
  useEffect(() => {
    if (!isSupported) return;
    return () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore — best-effort cleanup
      }
    };
  }, [isSupported]);

  const stop = useCallback(() => {
    if (!isSupported) return;
    // Bumping the token invalidates any in-flight closures so their late
    // onend/onerror events become no-ops.
    tokenRef.current += 1;
    queueRef.current = [];
    currentIdRef.current = null;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    setIsSpeaking(false);
    setSpeakingId(null);
  }, [isSupported]);

  const speak = useCallback(
    (text: string, id?: string | number) => {
      if (!isSupported) return;
      const cleaned = markdownToSpeech(text);
      if (!cleaned) return;

      // If something is already speaking for THIS id, treat as toggle off.
      if (id !== undefined && currentIdRef.current === id) {
        stop();
        return;
      }
      // Otherwise cancel any previous speech and start fresh.
      stop();

      const synth = window.speechSynthesis;
      // Cold-start fallback: getVoices() can be empty on the very first
      // speak() call (Chrome/iOS populate asynchronously via voiceschanged).
      // Re-poll once now so the very first utterance still gets a French
      // voice instead of the system default (often English).
      if (voicesRef.current.length === 0) {
        voicesRef.current = synth.getVoices();
      }
      const voice = pickFrenchVoice(voicesRef.current);
      const chunks = splitForSpeech(cleaned);
      const capturedId = id ?? null;
      tokenRef.current += 1;
      const myToken = tokenRef.current;
      currentIdRef.current = capturedId;
      setSpeakingId(capturedId);
      setIsSpeaking(true);

      const utterances = chunks.map((chunk) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = lang;
        u.rate = rate;
        u.pitch = pitch;
        if (voice) u.voice = voice;
        return u;
      });
      queueRef.current = utterances;

      // Reset the speaking state when the queue truly finishes OR when an
      // utterance errors with anything other than the cancel/interrupt codes
      // (those fire on intentional stop()). Without resetting on mid-queue
      // errors, the UI would stay locked in "speaking" forever (Chrome
      // aborts the queue on synthesis errors and the last utterance's onend
      // never fires). The token check makes the guard airtight even when
      // the caller re-speaks the same id back-to-back.
      const reset = () => {
        if (tokenRef.current !== myToken) return;
        queueRef.current = [];
        currentIdRef.current = null;
        setIsSpeaking(false);
        setSpeakingId(null);
      };

      utterances.forEach((u, i) => {
        const isLast = i === utterances.length - 1;
        u.onend = () => {
          if (isLast) reset();
        };
        u.onerror = (e) => {
          const errCode = (e as SpeechSynthesisErrorEvent).error;
          // 'interrupted' (Chrome) and 'canceled' (Safari) fire on
          // intentional stop() — let the stop() flow drive state.
          if (errCode === 'interrupted' || errCode === 'canceled') return;
          // Any other error is terminal: synthesis failure aborts the
          // remainder of the queue, so reset state immediately rather than
          // waiting for an onend that will never come.
          reset();
        };
        synth.speak(u);
      });
    },
    [isSupported, lang, rate, pitch, stop],
  );

  return { speak, stop, isSpeaking, speakingId, isSupported };
}
