/**
 * useSpeechRecognition — wrapper around the browser's Web Speech
 * Recognition API (window.SpeechRecognition / webkitSpeechRecognition)
 * for hands-free question dictation in the AI assistant.
 *
 * Default language: fr-CA. Auto-stop on silence is the browser's
 * native behavior — no manual timeout required.
 *
 * Browser support: Chrome (Android + desktop), Safari iOS 16.4+, Edge.
 * Firefox does NOT support speech recognition — `isSupported` returns
 * false there and consumers can hide the button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseSpeechRecognitionOptions {
  /** BCP-47 language. Default 'fr-CA'. */
  lang?: string;
  /** Keep recognizing until the user stops manually. Default false (auto-stop on silence). */
  continuous?: boolean;
  /** Receive partial results while speaking. Default true. */
  interimResults?: boolean;
}

export interface UseSpeechRecognitionReturn {
  /** Begin listening. Resets `transcript` and `interimTranscript`. */
  start: () => void;
  /** Stop listening (the final transcript is preserved). */
  stop: () => void;
  /** Manually clear `transcript`. */
  reset: () => void;
  /** Final recognized text accumulated since the last `start()`. */
  transcript: string;
  /** Live preview of the current utterance (resets when finalized). */
  interimTranscript: string;
  /** True between `start()` and recognition end. */
  isListening: boolean;
  /** False when the browser does not support speech recognition. */
  isSupported: boolean;
  /** Last error from the recognition service, or null. */
  error: string | null;
}

// The Web Speech API is not in the standard `lib.dom.d.ts` of older TS
// versions, so we declare a minimal local type without polluting globals.
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang = 'fr-CA', continuous = false, interimResults = true } = options;

  const Ctor = getSpeechRecognitionConstructor();
  const isSupported = Ctor !== null;

  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (r) {
      try {
        r.stop();
      } catch {
        // already stopped
      }
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;

    // Stop and reset any previous instance.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    setTranscript('');
    setInterimTranscript('');
    setError(null);

    const r = new Ctor();
    r.lang = lang;
    r.continuous = continuous;
    r.interimResults = interimResults;

    r.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript;
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      if (finalText) {
        setTranscript((prev) => (prev ? `${prev} ${finalText}` : finalText).trim());
        setInterimTranscript('');
      } else if (interim) {
        setInterimTranscript(interim);
      }
    };

    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      const errCode = e.error;
      // 'no-speech' fires when the user starts and doesn't talk — silent.
      // 'aborted' fires on intentional stop()/abort() — silent.
      if (errCode === 'no-speech' || errCode === 'aborted') return;
      // Map common error codes to user-facing French messages so the UI
      // can show actionable feedback instead of the raw code.
      const errorMessages: Record<string, string> = {
        'not-allowed': 'Permission micro refusée. Activez-la dans les réglages du navigateur.',
        'service-not-allowed': 'Reconnaissance vocale bloquée (HTTPS requis).',
        'audio-capture': 'Aucun microphone détecté.',
        'network': 'Pas de connexion Internet pour la dictée vocale.',
        'language-not-supported': 'Langue fr-CA non supportée par ce navigateur.',
        'bad-grammar': 'Erreur de grammaire de reconnaissance.',
      };
      setError(errorMessages[errCode] ?? `Erreur de reconnaissance: ${errCode}`);
      // Defensively clear listening state. The W3C spec says `end` fires
      // after `error`, but several Chrome Android builds skip `onend` after
      // a terminal error (e.g. `not-allowed`), leaving the UI stuck with
      // `isListening=true` (placeholder "Parlez maintenant…", Send disabled
      // forever). Clear state here too — the `onend` guard at the bottom
      // becomes a no-op if it does eventually fire.
      if (recognitionRef.current === r) {
        setIsListening(false);
        setInterimTranscript('');
        recognitionRef.current = null;
      }
    };

    r.onend = () => {
      // Guard: this onend may fire AFTER the user double-tapped the mic and
      // we already created a fresh recognizer instance. Only clear state
      // if THIS instance is still the current one.
      if (recognitionRef.current === r) {
        setIsListening(false);
        setInterimTranscript('');
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = r;
    try {
      r.start();
      setIsListening(true);
    } catch {
      // r.start() throws when called on an already-started recognizer
      // (race during rapid double-clicks). The native error message is in
      // English — replace with a French message for parity with the
      // mapped onerror codes above.
      setError('Impossible de démarrer la reconnaissance vocale.');
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, [Ctor, lang, continuous, interimResults]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      if (r) {
        try {
          r.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    start,
    stop,
    reset,
    transcript,
    interimTranscript,
    isListening,
    isSupported,
    error,
  };
}
