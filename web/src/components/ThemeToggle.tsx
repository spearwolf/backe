import { Monitor, Moon, Sun } from 'lucide-react';
import { m } from '../app/app.messages.ts';
import type { Theme, ThemeChoice } from '../app/theme.ts';
import { useSignal } from '../data/use-signal.ts';
import { Button } from './ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

const isChoice = (v: string): v is ThemeChoice => v === 'light' || v === 'dark' || v === 'system';

export function ThemeToggle({ theme }: { theme: Theme }) {
  const choice = useSignal(theme.choice);
  const Current = ICONS[choice];
  const label = { light: m.themeLight, dark: m.themeDark, system: m.themeSystem };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={m.theme} title={m.theme}>
          <Current aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(v) => {
            if (isChoice(v)) theme.set(v);
          }}
        >
          {(['light', 'dark', 'system'] as const).map((c) => {
            const Icon = ICONS[c];
            return (
              <DropdownMenuRadioItem key={c} value={c}>
                <Icon aria-hidden="true" />
                {label[c]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
