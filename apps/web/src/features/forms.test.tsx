// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { History, ReasonDialog } from '@/components/document-parts';
import { SearchInput } from '@/components/filters';
import { formatRelative } from '@/features/notifications/format';
import {
  Availability,
  newSalesLine,
  toSalesLineInput,
  validateSalesLines,
} from '@/features/sales/SalesLinesEditor';
import { newQuantityLine, validateQuantityLines } from '@/features/warehouse/components';
import { ApiError } from '@/lib/api-client';

const warehouse = (id: string, code: string, available: number, isActive = true) => ({
  warehouse: { id, code, name: code, isActive },
  onHand: available,
  reserved: 0,
  available,
  quarantine: 0,
});

describe('sales order lines', () => {
  it('validates quantity, price and discount with API-style paths', () => {
    const errors = validateSalesLines([
      newSalesLine({ productId: 'a', quantity: '0' }),
      newSalesLine({ productId: '', quantity: '2', unitPrice: '1.234', discount: '150' }),
    ]);
    expect(errors).toEqual({
      'lines.0.quantity': 'Enter 1 or more',
      'lines.1.productId': 'Select a product',
      'lines.1.unitPrice': 'Enter an amount such as 12.50',
      'lines.1.discountRate': '0–100%',
    });
    expect(validateSalesLines([])).toEqual({ lines: 'Add at least one product' });
  });

  it('converts entered decimals to minor units and basis points', () => {
    expect(
      toSalesLineInput(
        newSalesLine({ productId: 'p', quantity: '3', unitPrice: '12.5', discount: '7.25' }),
      ),
    ).toEqual({
      productId: 'p',
      quantity: 3,
      unitPrice: 1250,
      discountRate: 725,
    });
    // A blank price lets the server use the product's selling price.
    expect(toSalesLineInput(newSalesLine({ productId: 'p', quantity: '1' }))).not.toHaveProperty(
      'unitPrice',
    );
  });

  it('warns when a line is short and points to warehouses that have stock', () => {
    render(
      <Availability
        stock={[
          warehouse('m', 'MAIN', 6),
          warehouse('n', 'NORTH', 9),
          warehouse('x', 'OLD', 50, false),
        ]}
        warehouseId="m"
        quantity={10}
        unit="pcs"
      />,
    );
    expect(screen.getByText('6 pcs')).toHaveClass('text-red-700');
    expect(screen.getByText('Short by 4. NORTH: 9')).toBeInTheDocument();
  });
});

describe('quantity lines', () => {
  it('rejects duplicates, per source when sources matter', () => {
    const lines = [
      newQuantityLine({ productId: 'p', quantity: '2', source: 'quarantine' }),
      newQuantityLine({ productId: 'p', quantity: '1', source: 'usable' }),
    ];
    expect(validateQuantityLines(lines)).toEqual({ 'lines.1.productId': 'Already on the list' });
    expect(validateQuantityLines(lines, true)).toEqual({});
  });
});

describe('ReasonDialog', () => {
  it('requires a reason, trims it, and shows the server’s error', async () => {
    const onConfirm = vi
      .fn<(reason: string) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(409, 'INVALID_STATE', 'Already cancelled'))
      .mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();
    render(
      <ReasonDialog
        open
        onOpenChange={onOpenChange}
        title="Cancel order"
        description="Releases stock."
        confirmLabel="Cancel order"
        destructive
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Cancel order' });
    await userEvent.click(confirm);
    expect(screen.getByText('Enter a reason')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Reason'), '  Customer withdrew  ');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Customer withdrew');
    expect(await screen.findByText('Already cancelled')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(confirm);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('History', () => {
  it('lists entries newest first with readable labels', () => {
    render(
      <History
        entries={[
          { action: 'created', at: '2026-11-01T10:00:00Z', by: { id: '1', name: 'Ana' }, note: '' },
          {
            action: 'shipment_dispatched',
            at: '2026-11-02T10:00:00Z',
            by: { id: '2', name: 'Ben' },
            note: 'SHP-1',
          },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Dispatched');
    expect(items[0]).toHaveTextContent('SHP-1');
    expect(items[1]).toHaveTextContent('Created');
  });
});

describe('SearchInput', () => {
  it('reports the trimmed text once typing pauses', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <SearchInput value="" onChange={onChange} placeholder="Search" label="Search products" />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    for (const text of ['w', 'wi', 'wid ']) fireEvent.change(input, { target: { value: text } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('wid');
    vi.useRealTimers();
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('describes recent times relatively and older ones as dates', () => {
    expect(formatRelative('2026-11-08T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-11-08T11:55:00Z', now)).toMatch(/5 minutes ago/);
    expect(formatRelative('2026-11-08T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(formatRelative('2026-11-07T12:00:00Z', now)).toMatch(/yesterday/);
    expect(formatRelative('2026-10-01T12:00:00Z', now)).not.toMatch(/ago/);
  });
});
