/**
 * SpeakButton — discrete speaker icon attached to AI assistant messages.
 * Click toggles between "speak this message" and "stop speaking".
 *
 * Caller wires it to a `useTextToSpeech()` hook so multiple messages
 * share a single synthesizer instance and only one speaks at a time.
 */

import { Volume2, Square } from 'lucide-react';

interface SpeakButtonProps {
  /** True when this specific message is currently being read. */
  isSpeaking: boolean;
  /** Click handler — should call `tts.speak(text, id)` or `tts.stop()`. */
  onClick: () => void;
  /** Hide the button entirely if the platform doesn't support TTS. */
  isSupported?: boolean;
  /** Optional extra class names. */
  className?: string;
}

export function SpeakButton({
  isSpeaking,
  onClick,
  isSupported = true,
  className = '',
}: SpeakButtonProps) {
  if (!isSupported) return null;

  const Icon = isSpeaking ? Square : Volume2;
  const label = isSpeaking ? 'Arrêter la lecture' : 'Écouter ce message';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={isSpeaking}
      // 40×40 keeps the button comfortably tappable even with construction
      // gloves (between WCAG AA 24×24 and Apple HIG 44×44). No `title=`
      // because aria-label already announces it; doubling causes screen
      // readers to repeat the label.
      className={`inline-flex items-center justify-center rounded-lg min-h-[40px] min-w-[40px] p-2 transition-colors ${
        isSpeaking
          ? 'text-seaop-primary-600 dark:text-seaop-primary-400 bg-seaop-primary-50 dark:bg-seaop-primary-900/30 animate-pulse'
          : 'text-gray-400 hover:text-seaop-primary-600 dark:hover:text-seaop-primary-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      } ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
