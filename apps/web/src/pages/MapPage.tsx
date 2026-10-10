import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import { FilterBar } from '@/components/FilterBar';
import { Page } from '@/components/Layout';
import { matches, prefsFrom, sortDerived, type Derived } from '@/lib/derive';
import { useListingData } from '@/lib/useListingData';
import { useOpenListing } from '@/lib/useOpenListing';
import { useFilters } from '@/store/filters';
import { matchTier } from '@af/shared';

const UK_CENTRE: [number, number] = [54.4, -2.8];
const TIER_CLASS = { high: 'af-pin-high', medium: 'af-pin-medium', low: 'af-pin-low' } as const;

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Pins in clusters (leaflet.markercluster, driven directly; one pin per location of a listing). */
function Pins({ items, onOpen }: { items: Derived[]; onOpen: (id: string) => void }) {
  const map = useMap();
  useEffect(() => {
    const group = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
    for (const d of items) {
      const tier = matchTier(d.score);
      const seen = new Set<string>();
      for (const l of d.row.locations ?? []) {
        if (typeof l.lat !== 'number' || typeof l.lon !== 'number') continue;
        const key = `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const marker = L.marker([l.lat, l.lon], {
          icon: L.divIcon({ className: `af-pin ${TIER_CLASS[tier]}`, iconSize: [16, 16] }),
          title: d.row.title,
          keyboard: true,
        });
        marker.bindPopup(
          `<div class="af-popup"><strong>${escape(d.row.title)}</strong><br>${escape(d.row.employer_name)}${l.city ? ` · ${escape(l.city)}` : ''}<br><span>${d.score} · ${tier} match</span><br><button type="button" data-open="${d.row.id}">Open</button></div>`,
        );
        marker.on('popupopen', (ev) => {
          const btn = (ev.popup.getElement() as HTMLElement | undefined)?.querySelector(
            'button[data-open]',
          );
          btn?.addEventListener('click', () => onOpen(d.row.id), { once: true });
        });
        group.addLayer(marker);
      }
    }
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
    };
  }, [items, map, onOpen]);
  return null;
}

export default function MapPage() {
  const { derived, rows, home, settings } = useListingData();
  const filters = useFilters();
  const open = useOpenListing();
  const visible = useMemo(
    () =>
      sortDerived(
        derived.filter((d) => matches(d, filters)),
        filters.sort,
      ),
    [derived, filters],
  );
  const mapped = visible.filter((d) =>
    (d.row.locations ?? []).some((l) => typeof l.lat === 'number'),
  );
  const radius = filters.maxDistance ?? settings?.default_distance_miles ?? null; // null: no circle
  const activeCount = useMemo(() => derived.filter((d) => d.row.is_active).length, [derived]);

  return (
    <Page title="Map">
      <FilterBar
        rows={rows}
        shown={visible.length}
        total={activeCount}
        hasHome={!!home}
        prefs={prefsFrom(settings)}
      />
      <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
        {mapped.length} of {visible.length} on the map
        {visible.length > mapped.length &&
          ` (${visible.length - mapped.length} have no known location)`}
      </p>
      <div className="h-[calc(100dvh-17rem)] min-h-80 overflow-hidden rounded-xl border sm:h-[calc(100dvh-15rem)]">
        <MapContainer
          center={home ? [home.lat, home.lon] : UK_CENTRE}
          zoom={home ? 8 : 6}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {home && (
            <>
              <CircleMarker
                center={[home.lat, home.lon]}
                radius={7}
                // SVG attributes can't use CSS variables: the app's primary blue.
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}
              />
              {radius && (
                <Circle
                  center={[home.lat, home.lon]}
                  radius={radius * 1609.34}
                  pathOptions={{ color: '#2563eb', fillOpacity: 0.05, weight: 1 }}
                />
              )}
            </>
          )}
          <Pins items={mapped} onOpen={open} />
        </MapContainer>
      </div>
    </Page>
  );
}
