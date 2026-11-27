import { CircleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { m } from '../app/app.messages.ts';
import { cn } from '../lib/utils.ts';

type Props = {
  children: ReactNode;
  /** Für die Fehlerzeile, etwa der Rand, den an dieser Stelle der Fallback von `Suspense` hat. */
  className?: string;
};

/**
 * Fängt einen nachgeladenen Chunk ab, der nicht kommt (`React.lazy`). Nach einem Upgrade zeigen
 * die Hashes einer offenen Seite ins Leere; der abgelehnte `import()` ließe ohne Grenze die ganze
 * App leer stehen. So steht an der Stelle der Ansicht eine Zeile, der Rest bleibt bedienbar.
 * `React.lazy` merkt sich die Ablehnung; erst ein Neuladen der Seite holt den Chunk neu.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="alert" className={cn('flex items-center gap-2 text-sm', this.props.className)}>
        <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        {m.chunkFailed}
      </p>
    );
  }
}
