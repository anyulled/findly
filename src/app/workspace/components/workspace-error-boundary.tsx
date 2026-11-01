"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "../../page.module.css";
import { logger } from "@/lib/logger";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  errorMessage?: string;
}

export class WorkspaceErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error(
      "WorkspaceErrorBoundary caught an error during render",
      { componentStack: errorInfo.componentStack },
      error,
    );
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: undefined });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            padding: "24px",
            margin: "16px 0",
            backgroundColor: "#fff1f0",
            border: "1px solid #ffa39e",
            borderRadius: "8px",
            color: "#a43a32",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: 600 }}>
            {this.props.fallbackTitle ?? "Ha ocurrido un error al cargar esta sección"}
          </h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#595959" }}>
            Se ha producido un problema inesperado en la interfaz. Puedes intentar recargar la sección.
          </p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={this.handleReset}
            style={{ cursor: "pointer" }}
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
