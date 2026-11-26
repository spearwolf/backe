import { CircleAlert } from 'lucide-react';
import { m } from '../app/app.messages.ts';

export function ErrorPage({ message, hint }: { message: string; hint?: string | undefined }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-4">
        <h1 className="flex items-center gap-2 font-semibold text-destructive">
          <CircleAlert className="size-4" aria-hidden="true" />
          {m.errorTitle}
        </h1>
        <p>{message}</p>
        {hint !== undefined && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
    </main>
  );
}
