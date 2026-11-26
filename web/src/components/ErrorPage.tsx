import { CircleAlert } from 'lucide-react';
import { m } from '../app/app.messages.ts';

type AlertProps = { title: string; message: string; hint?: string | undefined };

/** Fehler mit Icon und Text; `message` und `hint` kommen, wie der Server sie schickt. */
export function ErrorAlert({ title, message, hint }: AlertProps) {
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-4">
      <h1 className="flex items-center gap-2 font-semibold text-destructive">
        <CircleAlert className="size-4" aria-hidden="true" />
        {title}
      </h1>
      <p>{message}</p>
      {hint !== undefined && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorPage({ message, hint }: { message: string; hint?: string | undefined }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <ErrorAlert title={m.errorTitle} message={message} hint={hint} />
    </main>
  );
}
