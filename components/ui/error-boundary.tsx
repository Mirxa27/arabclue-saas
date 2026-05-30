"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center gap-5 bg-backdrop"
        >
          <span className="w-14 h-14 rounded-2xl bg-accent-warm/10 border border-accent-warm/20 flex items-center justify-center">
            <AlertTriangle size={28} className="text-accent-warm" />
          </span>
          <div className="space-y-2 max-w-md">
            <h2 className="text-xl font-semibold text-ink">
              Something went wrong
            </h2>
            <p className="text-sm text-ink-soft">
              {this.state.error?.message ??
                "An unexpected error occurred. Please try again."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={this.handleReset}
          >
            <RefreshCw size={16} />
            <span>Try again</span>
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}