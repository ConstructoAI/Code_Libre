/**
 * Mobile React Frontend - Error Boundary
 * Capture les exceptions React qui demonteraient sinon tout le layout.
 * En prod, React minifie les erreurs (#185, etc.) — on affiche le decodeur officiel.
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || String(this.state.error);
    const isMinified = /Minified React error #(\d+)/.exec(msg);
    const decoderUrl = isMinified
      ? `https://react.dev/errors/${isMinified[1]}`
      : null;

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <AlertTriangle className="h-12 w-12 text-red-500 mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Erreur d&apos;affichage
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 max-w-md break-words">
          {msg}
        </p>
        {decoderUrl && (
          <a
            href={decoderUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 underline mb-4"
          >
            Décoder cette erreur React
          </a>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" /> Réessayer
          </button>
          <button
            onClick={this.handleReload}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
