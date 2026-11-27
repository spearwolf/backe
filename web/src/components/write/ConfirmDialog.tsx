import { type ReactNode, useRef } from 'react';
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
  /**
   * Fokus nach dem Schließen. Ohne Angabe geht er an das Element, das beim Öffnen fokussiert war,
   * sofern es noch im Dokument steht (siehe `ConfirmDialog`).
   */
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
 *
 * Radix gibt den Fokus beim Schließen nur an einen `DialogTrigger` zurück; dieser Dialog wird über
 * `open` gesteuert und hat keinen, der Fokus fiele auf `body`. Darum merkt er sich beim Öffnen das
 * fokussierte Element (`onOpenAutoFocus` läuft, bevor der Fokus in den Dialog wandert) und gibt
 * den Fokus beim Schließen dorthin zurück. Wer selbst entscheidet (`onCloseAutoFocus`, etwa weil
 * der Auslöser mit der Aktion verschwindet), übernimmt das ganz.
 */
export function ConfirmDialog(props: Props) {
  const { open, title, description, confirmLabel, destructive, busy, error, children } = props;
  const onOpenChange = (next: boolean): void => {
    if (!busy) props.onOpenChange(next);
  };
  const opener = useRef<HTMLElement | null>(null);
  const onOpenAutoFocus = (): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const onCloseAutoFocus =
    props.onCloseAutoFocus ??
    ((event: Event): void => {
      const from = opener.current;
      opener.current = null;
      if (from?.isConnected !== true) return;
      event.preventDefault();
      from.focus();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        closeLabel={m.dismiss}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
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
