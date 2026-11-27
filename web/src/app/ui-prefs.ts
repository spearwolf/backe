/**
 * Einstellungen der Oberfläche (ui.md §2.10 »Oberfläche«): Sprache, externe Bilder in Markdown und
 * die Default-Gruppierung des Boards. Sie gelten für alle Backlogs und liegen nur im
 * `localStorage`; ungültige Werte zählen als nicht gesetzt.
 */
import { type Locale, setLocale } from '@backe/i18n/locale.ts';
import {
  createMemo,
  createSignal,
  type Signal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';
import { readText, writeText } from '../lib/storage.ts';
import { BOARD_GROUPS, type BoardGroup, DEFAULT_BOARD_VIEW } from './board-model.ts';

export type LangChoice = 'server' | 'en' | 'de';

export const LANG_KEY = 'backe-ui-lang';
export const EXTERNAL_IMAGES_KEY = 'backe-ui-external-images';
export const BOARD_GROUP_KEY = 'backe-ui-board-group';

// Ein leerer oder fremder Wert heißt »wie der Server«; `writeText` kennt kein Entfernen.
const parseLang = (raw: string | undefined): LangChoice =>
  raw === 'en' || raw === 'de' ? raw : 'server';

// Nur ein ausdrückliches Aus blockt: Bilder sind erlaubt, solange nichts anderes gewählt ist.
const parseImages = (raw: string | undefined): boolean => raw !== 'false';

const parseGroup = (raw: string | undefined): BoardGroup =>
  BOARD_GROUPS.includes(raw as BoardGroup) ? (raw as BoardGroup) : DEFAULT_BOARD_VIEW.group;

export class UiPrefs {
  readonly serverLang: Locale;
  readonly langChoice: Signal<LangChoice>;
  /** Wirksame Sprache: Wahl oder Server-Sprache. */
  readonly lang: SignalReader<Locale>;
  readonly externalImages: Signal<boolean>;
  readonly boardGroup: Signal<BoardGroup>;
  readonly #root: HTMLElement;
  #focusLang = false;

  constructor(serverLang: Locale, root: HTMLElement = document.documentElement) {
    this.serverLang = serverLang;
    this.#root = root;
    this.langChoice = createSignal<LangChoice>(parseLang(readText(LANG_KEY)), { attach: this });
    this.lang = createMemo(
      (): Locale => {
        const choice = this.langChoice.get();
        return choice === 'server' ? this.serverLang : choice;
      },
      { attach: this },
    );
    this.externalImages = createSignal(parseImages(readText(EXTERNAL_IMAGES_KEY)), {
      attach: this,
    });
    this.boardGroup = createSignal(parseGroup(readText(BOARD_GROUP_KEY)), { attach: this });
    // Vor dem ersten Rendern: Die Kataloge lesen die Locale bei jedem Zugriff.
    this.#applyLang(this.lang());
  }

  /**
   * Die Locale steht, bevor das Signal wechselt: Wer auf `lang` hin neu rendert, liest schon die
   * neuen Texte. Die neu gemountete Sprachwahl in Settings holt sich danach den Fokus zurück.
   */
  setLang(choice: LangChoice): void {
    writeText(LANG_KEY, choice === 'server' ? '' : choice);
    this.#focusLang = true;
    this.#applyLang(choice === 'server' ? this.serverLang : choice);
    this.langChoice.set(choice);
  }

  setExternalImages(on: boolean): void {
    this.externalImages.set(on);
    writeText(EXTERNAL_IMAGES_KEY, String(on));
  }

  setBoardGroup(group: BoardGroup): void {
    this.boardGroup.set(group);
    writeText(BOARD_GROUP_KEY, group);
  }

  /** Einmalig true nach `setLang`: Die neu gemountete Sprachwahl holt sich den Fokus. */
  takeLangFocus(): boolean {
    const take = this.#focusLang;
    this.#focusLang = false;
    return take;
  }

  dispose(): void {
    SignalGroup.delete(this);
  }

  #applyLang(lang: Locale): void {
    setLocale(lang);
    this.#root.lang = lang;
  }
}
