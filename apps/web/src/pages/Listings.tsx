import { Page } from '@/components/Layout';

export default function Listings() {
  return (
    <Page title="Listings">
      <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        No listings yet. The daily scrape fills this page.
      </div>
    </Page>
  );
}
