import type { BacklogEntryJson } from '@backe/ui/api.ts';
import { m } from '../app/app.messages.ts';
import type { Theme } from '../app/theme.ts';
import type { Session } from '../data/session.ts';
import { BacklogSwitcher } from './BacklogSwitcher.tsx';
import { SyncIndicator } from './SyncIndicator.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { Badge } from './ui/badge.tsx';

type Props = {
  backlogs: readonly BacklogEntryJson[];
  current: BacklogEntryJson | undefined;
  session: Session | undefined;
  theme: Theme;
};

export function Header({ backlogs, current, session, theme }: Props) {
  return (
    <header className="flex items-center gap-4 px-4 py-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="font-semibold">backe</span>
        <span aria-hidden="true">·</span>
        <span className="truncate text-sm text-muted-foreground">{m.tagline}</span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <BacklogSwitcher backlogs={backlogs} current={current?.name} />
        {current?.user != null && (
          <span className="flex items-center gap-1.5 text-sm">
            <span className="font-mono">{current.user}</span>
            {!current.can_write && <Badge variant="outline">{m.readOnly}</Badge>}
          </span>
        )}
        {session !== undefined && <SyncIndicator session={session} />}
        <ThemeToggle theme={theme} />
      </div>
    </header>
  );
}
