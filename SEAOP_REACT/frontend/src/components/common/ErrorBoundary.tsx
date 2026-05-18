/**
 * SEAOP React Frontend - Error Boundary
 * Catches unhandled rendering errors and displays a fallback UI.
 * Uses a class component as required by React's error boundary API.
 */

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Optional custom fallback UI. If omitted, the default error card is shown. */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console in development; could send to Sentry in production
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback takes priority
    if (this.props.fallback) {
      return this.props.fallback;
    }

    // Default error card
    return (
      <div className="flex items-center justify-center min-h-[30vh] p-6">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-800 dark:bg-gray-800">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500 dark:text-red-400" />

          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Une erreur est survenue
          </h3>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {this.state.error?.message || 'Erreur inattendue lors du rendu de ce composant.'}
          </p>

          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-seaop-primary px-4 py-2 text-sm font-medium text-white hover:bg-seaop-primary-700 transition-colors"
          >
            <RefreshCw size={16} />
            Réessayer
          </button>
        </div>
      </div>
    );
  }
}
