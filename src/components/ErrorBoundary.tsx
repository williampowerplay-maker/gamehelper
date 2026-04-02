"use client";

import React from "react";
import { logClientError } from "@/lib/logError";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  componentName?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || "Unknown error" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logClientError(
      "client_render",
      error?.message || "Render error",
      error?.stack,
      {
        component: this.props.componentName || "unknown",
        componentStack: info.componentStack?.slice(0, 500),
        url: typeof window !== "undefined" ? window.location.pathname : "",
      }
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <div className="text-4xl mb-4">⚔️</div>
          <h2 className="text-lg font-semibold text-gray-200 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            The guide stumbled. This has been logged and we&apos;ll look into it.
          </p>
          <button
            onClick={this.handleReset}
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
