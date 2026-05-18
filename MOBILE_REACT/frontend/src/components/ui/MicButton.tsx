/**
 * MicButton — microphone toggle for the chat input. Lets the user
 * dictate a question instead of typing. Recognized text is delivered
 * via the `useSpeechRecognition()` hook in the calling component.
 *
 * Touch target is 44×44 (iOS HIG / Material guideline) so it's easy to
 * tap on a phone even with gloves on.
 */

import { Mic } from 'lucide-react';

interface MicButtonProps {
  isListening: boolean;
  onClick: () => void;
  isSupported?: boolean;
  /** Disable while sending or other busy state. */
  disabled?: boolean;
  className?: string;
}

export function MicButton({
  isListening,
  onClick,
  isSupported = true,
  disabled = false,
  className = '',
}: MicButtonProps) {
  if (!isSupported) return null;

  const label = isListening ? 'Arrêter la dictée' : 'Dicter une question';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isListening}
      className={`inline-flex items-center justify-center rounded-xl min-h-[44px] min-w-[44px] p-2.5 transition-colors disabled:opacity-30 ${
        isListening
          ? 'text-white bg-red-500 hover:bg-red-600 animate-pulse'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      } ${className}`}
    >
      <Mic className="h-5 w-5" />
    </button>
  );
}
