import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiError } from '../../data/api-client.ts';

/** Der kompakte Fehlerkasten: `message` und `hint` stehen, wie der Server sie schickt. */
export function ErrorBox({
  error,
  compact,
  children,
}: {
  error: ApiError;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-md border border-destructive/50 text-sm ${compact === true ? 'p-2' : 'p-3'}`}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p>{error.message}</p>
        {error.hint !== undefined && <p className="text-muted-foreground">{error.hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Fehlerfläche einer Aktion. */
export function ActionError({ error }: { error: ApiError | undefined }) {
  return error === undefined ? null : <ErrorBox error={error} />;
}
