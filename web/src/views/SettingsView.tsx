import { m } from '../app/app.messages.ts';

/** Platzhalter bis zu den Settings. */
export function SettingsView() {
  return (
    <section className="p-4">
      <h1 className="text-lg font-semibold">{m.settings}</h1>
    </section>
  );
}
