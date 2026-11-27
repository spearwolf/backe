/**
 * Fake für die Notification-API des Browsers (jsdom hat keine). `installNotifications` ersetzt
 * `globalThis.Notification` bis zum Abbau; wer es aufruft, ruft `uninstall()` selbst, etwa aus
 * einem `afterEach`.
 */
export interface ShownNote {
  title: string;
  body: string;
  tag: string;
  closed: boolean;
  /** Löst `onclick` aus, wie ein Klick auf die Meldung. */
  click(): void;
}

export interface NotificationsFake {
  shown: ShownNote[];
  /** Anzahl der Aufrufe von `Notification.requestPermission()`. */
  requests: number;
  uninstall(): void;
}

export function installNotifications(opts: {
  permission: NotificationPermission | 'missing';
  answer?: NotificationPermission;
}): NotificationsFake {
  const g = globalThis as { Notification?: unknown };
  const had = Object.hasOwn(g, 'Notification');
  const previous = g.Notification;
  const fake: NotificationsFake = {
    shown: [],
    requests: 0,
    uninstall() {
      if (had) g.Notification = previous;
      else delete g.Notification;
    },
  };
  if (opts.permission === 'missing') {
    delete g.Notification;
    return fake;
  }
  class FakeNotification {
    static permission: NotificationPermission = opts.permission as NotificationPermission;
    static async requestPermission(): Promise<NotificationPermission> {
      fake.requests += 1;
      FakeNotification.permission = opts.answer ?? FakeNotification.permission;
      return FakeNotification.permission;
    }
    onclick: (() => void) | null = null;
    readonly #note: ShownNote;
    constructor(title: string, options: { body?: string; tag?: string } = {}) {
      this.#note = {
        title,
        body: options.body ?? '',
        tag: options.tag ?? '',
        closed: false,
        click: () => this.onclick?.(),
      };
      fake.shown.push(this.#note);
    }
    close(): void {
      this.#note.closed = true;
    }
  }
  g.Notification = FakeNotification;
  return fake;
}
