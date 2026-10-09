import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ListingCard } from '@/components/ListingCard';
import { ListingTable } from '@/components/ListingTable';
import { ListingDetail } from '@/components/ListingDetail';
import { derive } from '@/lib/derive';
import { listing, settings } from './fixtures';

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
    single: () =>
      Promise.resolve({
        data: {
          id: 'id-1',
          description_html:
            '<p>Hello <script>alert(1)</script><a href="https://x.test">link</a></p>',
          details: {
            qualifications: [{ qualificationType: 'A Level', subject: 'Maths', grade: 'BBC' }],
          },
          listing_sources: [],
        },
        error: null,
      }),
  };
  return {
    supabase: {
      from: () => chain,
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
    configError: null,
    appUrl: () => 'http://localhost/',
  };
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const derived = derive(
  [listing(), listing({ id: 'id-2', title: 'Data Analyst Apprentice', level: 4 })],
  settings,
  '2026-10-09',
);

describe('listing views render', () => {
  it('card', () => {
    wrap(<ListingCard d={derived[0]!} />);
    expect(screen.getByText('2027 Data Science Apprentice - Crawley')).toBeTruthy();
    expect(screen.getByText(/Thales UK Limited · Crawley/)).toBeTruthy();
    expect(screen.getByText('L6 · Degree')).toBeTruthy();
  });

  it('table', () => {
    wrap(<ListingTable data={derived} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Data Analyst Apprentice')).toBeTruthy();
  });

  it('detail sanitises the description and shows entry requirements', async () => {
    wrap(<ListingDetail d={derived[0]} onClose={() => {}} />);
    expect(await screen.findByText('link')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('<script>');
    expect(screen.getByRole('link', { name: 'link' }).getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/Maths/)).toBeTruthy();
  });
});
