import type { State } from '@backe/core/state.ts';
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  Eye,
  type LucideIcon,
  OctagonX,
} from 'lucide-react';
import { cn } from '../lib/utils.ts';

const ICONS: Record<State, LucideIcon> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  review: Eye,
  done: CircleCheck,
  blocked: OctagonX,
  on_hold: CirclePause,
  cancelled: CircleSlash,
  rejected: Ban,
};

/** State als Icon und Name, roh wie im CLI; nie nur Farbe (ui.md §2.13). */
export function StateIcon({ state, className }: { state: State; className?: string }) {
  const Icon = ICONS[state];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{state}</span>
    </span>
  );
}
