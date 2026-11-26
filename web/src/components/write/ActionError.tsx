import { CircleAlert } from 'lucide-react';
import type { ApiError } from '../../data/api-client.ts';

/** Fehlerfläche einer Aktion; `message` und `hint` stehen, wie der Server sie schickt. */
export function ActionError({ error }: { error: ApiError | undefined }) {
  if (error === undefined) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/50 p-3 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p>{error.message}</p>
        {error.hint !== undefined && <p className="text-muted-foreground">{error.hint}</p>}
      </div>
    </div>
  );
}
