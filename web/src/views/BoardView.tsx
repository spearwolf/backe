import { m } from '../app/app.messages.ts';

/** Platzhalter bis zum Board. */
export function BoardView() {
  return (
    <section className="p-4">
      <h1 className="text-lg font-semibold">{m.tabBoard}</h1>
    </section>
  );
}
