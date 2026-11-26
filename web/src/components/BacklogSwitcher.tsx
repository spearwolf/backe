import type { BacklogEntryJson } from '@backe/ui/api.ts';
import { ChevronDown } from 'lucide-react';
import { m } from '../app/app.messages.ts';
import { useRouter } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import { Button } from './ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';

type Props = { backlogs: readonly BacklogEntryJson[]; current: string | undefined };

/** Name und ID-Präfix je Backlog; die Auswahl ist ein Routenwechsel. */
export function BacklogSwitcher({ backlogs, current }: Props) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {current ?? m.chooseBacklog}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{m.backlogs}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current ?? ''}
          onValueChange={(name) => router.navigate(routeHref({ kind: 'backlog', backlog: name }))}
        >
          {backlogs.map((b) => (
            <DropdownMenuRadioItem key={b.name} value={b.name}>
              <span>{b.name}</span>
              {b.prefix !== null && (
                <span className="ml-auto pl-4 font-mono text-xs text-muted-foreground">
                  {b.prefix}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
