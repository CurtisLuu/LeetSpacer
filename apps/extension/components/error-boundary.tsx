import { Component, type ErrorInfo, type ReactNode } from "react";

import { onSuperseded } from "../lib/db-status";
import { Button } from "./button";
import { Callout } from "./callout";

interface Props {
  /** Names the surface in the console line, e.g. "side panel". */
  surface: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  /** Set when the database moved on under us, which needs different advice. */
  stale: boolean;
}

/**
 * Catches a render throw so one bad row can't blank the whole surface.
 *
 * Defence in depth rather than a fix for a known crash: every untrusted value reaches the
 * DOM as text, so there is no specific record that triggers this today. But a React tree
 * with no boundary anywhere unmounts itself on any throw, and what the user sees then is
 * an empty panel with no error, no explanation, and nothing to press — which reads as the
 * extension being broken rather than as one problem failing to render.
 *
 * It also handles the one non-hypothetical case: a newer version of the extension
 * upgraded the database while this page was open. This code is then the old code holding
 * a closed connection, and the only cure is a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, stale: false };
  private unsubscribe?: () => void;

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidMount(): void {
    this.unsubscribe = onSuperseded(() => this.setState({ stale: true }));
  }

  override componentWillUnmount(): void {
    this.unsubscribe?.();
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is the only part that says *where*, and it is lost by the time
    // this reaches any other handler.
    console.error(`[lcs] ${this.props.surface} crashed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.stale) {
      return (
        <div className="p-4">
          <Callout
            tone="info"
            title="LeetSpacer was updated"
            action={
              <Button variant="secondary" size="sm" onClick={() => location.reload()}>
                Reload
              </Button>
            }
          >
            This page is still running the previous version. Reload it to carry on — your
            data is untouched.
          </Callout>
        </div>
      );
    }

    if (this.state.failed) {
      return (
        <div className="p-4">
          <Callout
            tone="danger"
            title="Something went wrong here"
            action={
              <Button variant="secondary" size="sm" onClick={() => location.reload()}>
                Reload
              </Button>
            }
          >
            Nothing was lost — your schedule and history are stored separately from this
            view.
          </Callout>
        </div>
      );
    }

    return this.props.children;
  }
}
