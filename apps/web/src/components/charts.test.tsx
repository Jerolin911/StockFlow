// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BarList, ColumnChart, StatTile, niceMax } from './charts';

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(420)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
  });
});

describe('BarList', () => {
  it('sizes bars relative to the largest value and prints every value', () => {
    render(
      <BarList
        label="Stock by warehouse"
        rows={[
          { key: 'a', label: 'Main', value: 200 },
          { key: 'b', label: 'North', value: 50 },
          { key: 'c', label: 'Store', value: 0 },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Stock by warehouse' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Main200', 'North50', 'Store0']);
    const widths = items.map(
      (i) => (i.querySelector('[aria-hidden] > div') as HTMLElement).style.width,
    );
    expect(widths).toEqual(['100%', '25%', '0%']);
  });

  it('says so when there is nothing to show', () => {
    render(<BarList label="Empty" rows={[]} />);
    expect(screen.getByText('No data.')).toBeInTheDocument();
  });
});

describe('ColumnChart', () => {
  const points = [
    { key: '2026-11-01', label: '1 Nov', values: { in: 10, out: 4 } },
    { key: '2026-11-02', label: '2 Nov', values: { in: 0, out: 6 } },
    { key: '2026-11-03', label: '3 Nov', values: { in: 5, out: 0 } },
  ];
  const series = [
    { key: 'in', label: 'Units in' },
    { key: 'out', label: 'Units out' },
  ];

  it('shows a legend with totals and a tooltip for the focused period', async () => {
    render(<ColumnChart label="Units in and out" points={points} series={series} />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('Units in 15');
    expect(legend).toHaveTextContent('Units out 10');

    const period = screen.getByRole('img', { name: '2 Nov: Units in 0, Units out 6' });
    fireEvent.focus(period);
    expect(within(period).getByText('2 Nov')).toBeInTheDocument();
    expect(within(period).getByText('6')).toBeInTheDocument();
    fireEvent.blur(period);
    expect(within(period).queryByText('2 Nov')).not.toBeInTheDocument();
  });

  it('switches to a table listing every value', async () => {
    render(<ColumnChart label="Units in and out" points={points} series={series} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('1 Nov104');
    await userEvent.click(screen.getByRole('button', { name: 'Show chart' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('labels a single series with its total and no legend', () => {
    render(
      <ColumnChart
        label="Orders"
        points={points}
        series={[series[0]!]}
        format={(v) => `${v} orders`}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
    expect(screen.getByText('15 orders')).toBeInTheDocument();
  });
});

describe('StatTile', () => {
  it('links when given a destination and flags alerts', () => {
    render(
      <MemoryRouter>
        <StatTile label="Low stock" value="5" to="/stock?status=low" alert />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/stock?status=low');
    expect(screen.getByText('5')).toHaveClass('text-red-700');
  });
});
