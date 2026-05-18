import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center h-full bg-white dark:bg-neutral-900 p-4">
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400 font-semibold mb-2">Erreur</p>
            <p className="text-slate-500 dark:text-neutral-400 text-sm mb-3">{this.state.error?.message}</p>
            <button onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg">
              Réessayer
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
