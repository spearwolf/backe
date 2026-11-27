import type { Locale } from '@backe/i18n/locale.ts';
import { useId, useLayoutEffect, useRef } from 'react';
import { m as app } from '../../app/app.messages.ts';
import { BOARD_GROUPS, type BoardGroup } from '../../app/board-groups.ts';
import type { ThemeChoice } from '../../app/theme.ts';
import { useUi } from '../../app/ui-context.tsx';
import type { LangChoice } from '../../app/ui-prefs.ts';
import { useSignal } from '../../data/use-signal.ts';
import { m as board } from '../../views/board.messages.ts';
import { m } from '../../views/settings.messages.ts';
import { Field, SELECT_CLASS } from './fields.tsx';

// Sprachnamen stehen in ihrer eigenen Sprache: Wer die UI nicht lesen kann, findet so trotzdem
// die eigene.
const LANG_NAME: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

const THEMES: ReadonlyArray<{ value: ThemeChoice; label: () => string }> = [
  { value: 'light', label: () => app.themeLight },
  { value: 'dark', label: () => app.themeDark },
  { value: 'system', label: () => app.themeSystem },
];

// Dieselben Texte wie die Werkzeugleiste des Boards; die liegt im Board-Chunk, die Texte nicht.
const GROUP_LABEL: Record<BoardGroup, () => string> = {
  sprint: () => board.groupSprint,
  project: () => board.groupProject,
  repo: () => board.groupRepo,
  none: () => board.groupNone,
};

/** Abschnitt Oberfläche (ui.md §2.10): Theme, Sprache, externe Bilder, Default-Gruppierung. */
export function InterfaceSection() {
  const { theme, prefs } = useUi();
  const choice = useSignal(theme.choice);
  const lang = useSignal(prefs.langChoice);
  const images = useSignal(prefs.externalImages);
  const group = useSignal(prefs.boardGroup);
  const langSelect = useRef<HTMLSelectElement>(null);
  const imagesHint = useId();

  // Ein Sprachwechsel baut die App neu auf (`key={lang}` in `App`); die neue Sprachwahl holt sich
  // den Fokus zurück, bevor der Browser malt.
  useLayoutEffect(() => {
    if (prefs.takeLangFocus()) langSelect.current?.focus();
  }, [prefs]);

  return (
    <div className="max-w-xl space-y-5">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{app.theme}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {THEMES.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="settings-theme"
                className="size-4 accent-foreground"
                value={value}
                checked={choice === value}
                onChange={() => theme.set(value)}
              />
              {label()}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={m.language}>
        {({ id }) => (
          <select
            ref={langSelect}
            id={id}
            className={`${SELECT_CLASS} w-fit`}
            value={lang}
            // Die Optionen sind genau die Wahlmöglichkeiten.
            onChange={(e) => prefs.setLang(e.target.value as LangChoice)}
          >
            <option value="server">{m.langServer(LANG_NAME[prefs.serverLang])}</option>
            <option value="en">{LANG_NAME.en}</option>
            <option value="de">{LANG_NAME.de}</option>
          </select>
        )}
      </Field>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={images}
            aria-describedby={imagesHint}
            onChange={(e) => prefs.setExternalImages(e.target.checked)}
          />
          {m.externalImages}
        </label>
        <p id={imagesHint} className="text-xs text-muted-foreground">
          {m.externalImagesHint}
        </p>
      </div>

      <Field label={m.boardGroup} hint={m.boardGroupHint}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className={`${SELECT_CLASS} w-fit`}
            value={group}
            onChange={(e) => prefs.setBoardGroup(e.target.value as BoardGroup)}
          >
            {BOARD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABEL[g]()}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}
