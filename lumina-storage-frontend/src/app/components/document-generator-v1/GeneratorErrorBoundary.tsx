// @ts-nocheck
import { Component, type ReactNode } from 'react';
import i18next from 'i18next';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/app/components/ui/button';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GeneratorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[GeneratorErrorBoundary] Render crash:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    const t = (key: string) => i18next.t(key);
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <div className="text-center space-y-1 max-w-md">
            <p className="text-sm font-semibold text-foreground">{t('generatorV1.errorBoundary.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('generatorV1.errorBoundary.desc')}
            </p>
            {this.state.error?.message && (
              <pre className="mt-3 text-[11px] text-left text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.error.message}
              </pre>
            )}
          </div>
          <Button onClick={this.handleReset} className="gap-2">
            <RotateCcw className="w-4 h-4" />{t('generatorV1.errorBoundary.retryBtn')}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
