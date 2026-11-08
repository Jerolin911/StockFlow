import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  type HistoryEntryDto,
  type PurchaseOrderStatus,
  type PurchaseRequestStatus,
} from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
import { FormAlert } from '@/components/form-parts';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

type Tone = Parameters<typeof StatusBadge>[0]['tone'];

const PO_TONES: Record<PurchaseOrderStatus, Tone> = {
  draft: 'gray',
  pending_approval: 'amber',
  approved: 'blue',
  partially_received: 'blue',
  received: 'green',
  closed: 'gray',
  cancelled: 'red',
};

const PR_TONES: Record<PurchaseRequestStatus, Tone> = {
  draft: 'gray',
  submitted: 'amber',
  approved: 'blue',
  rejected: 'red',
  ordered: 'green',
  cancelled: 'red',
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <StatusBadge tone={PO_TONES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</StatusBadge>;
}

export function PurchaseRequestStatusBadge({ status }: { status: PurchaseRequestStatus }) {
  return (
    <StatusBadge tone={PR_TONES[status]}>{PURCHASE_REQUEST_STATUS_LABELS[status]}</StatusBadge>
  );
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  closed: 'Closed',
  received: 'Goods received',
  ordered: 'Purchase order created',
  reopened: 'Reopened',
};

export function History({ entries }: { entries: HistoryEntryDto[] }) {
  return (
    <ol className="grid gap-4">
      {[...entries].reverse().map((entry, index) => (
        <li key={index} className="relative pl-5">
          <span className="bg-primary/70 absolute top-1.5 left-0 size-2 rounded-full" aria-hidden />
          <p className="text-sm font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</p>
          <p className="text-muted-foreground text-xs">
            {entry.by.name} · {formatDateTime(entry.at)}
          </p>
          {entry.note ? <p className="mt-1 text-sm">{entry.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}

/** Confirmation that requires a written reason (reject, cancel, close). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: ReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ReasonForm
          confirmLabel={confirmLabel}
          destructive={destructive ?? false}
          onConfirm={onConfirm}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  confirmLabel,
  destructive,
  onConfirm,
  onDone,
}: {
  confirmLabel: string;
  destructive: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      setFieldError('Enter a reason');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={error} />
      <FormField id="reason" label="Reason" error={fieldError}>
        <Textarea
          {...fieldA11y('reason', fieldError)}
          rows={3}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setFieldError(undefined);
          }}
          autoFocus
        />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Back
        </Button>
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
