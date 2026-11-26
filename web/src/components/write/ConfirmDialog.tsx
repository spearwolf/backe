import type { ReactNode } from 'react';
import type { ApiError } from '../../data/api-client.ts';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import { ActionError } from './ActionError.tsx';
import { m } from './write.messages.ts';

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  /** Sperrt nur den Bestätigen-Knopf, etwa solange eine Pflichtangabe fehlt. */
  confirmDisabled?: boolean;
  error: ApiError | undefined;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
};

/**
 * Bestätigung mit eigener Fehlerfläche. Während `busy` läuft der Aufruf schon: Dann bleibt der
 * Dialog offen (Esc, Klick daneben, »Abbrechen« tun nichts), damit ein Fehler nicht ins Leere fällt.
 */
export function ConfirmDialog(props: Props) {
  const { open, title, description, confirmLabel, destructive, busy, error, children } = props;
  const onOpenChange = (next: boolean): void => {
    if (!busy) props.onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} closeLabel={m.dismiss}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          ) : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        <ActionError error={error} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {m.cancel}
          </Button>
          <Button
            type="button"
            variant={destructive === true ? 'destructive' : 'default'}
            disabled={busy || props.confirmDisabled === true}
            onClick={props.onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
