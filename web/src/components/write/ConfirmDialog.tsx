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

type BaseProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  /** Sperrt nur den Bestätigen-Knopf, etwa solange eine Pflichtangabe fehlt. */
  confirmDisabled?: boolean;
  error: ApiError | undefined;
  onOpenChange: (open: boolean) => void;
  /** Fokus nach dem Schließen; ohne Angabe der Radix-Default (das zuvor fokussierte Element). */
  onCloseAutoFocus?: (event: Event) => void;
  children?: ReactNode;
};

/**
 * Entweder bestätigt der Knopf selbst (`onConfirm`), oder er ist der Absende-Knopf des Formulars
 * mit der ID `formId`: Der Aufrufer legt `<form id={formId} onSubmit>` um seine Felder, Enter in
 * einem Feld bestätigt wie der Knopf, und bestätigt wird allein in `onSubmit`. Beides zugleich
 * gibt es nicht; ein `onConfirm` neben `formId` liefe nie.
 */
type Props = BaseProps &
  ({ formId?: undefined; onConfirm: () => void } | { formId: string; onConfirm?: never });

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
      <DialogContent
        showCloseButton={false}
        closeLabel={m.dismiss}
        {...(props.onCloseAutoFocus === undefined
          ? {}
          : { onCloseAutoFocus: props.onCloseAutoFocus })}
      >
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
            variant={destructive === true ? 'destructive' : 'default'}
            disabled={busy || props.confirmDisabled === true}
            {...(props.formId === undefined
              ? { type: 'button', onClick: props.onConfirm }
              : { type: 'submit', form: props.formId })}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
