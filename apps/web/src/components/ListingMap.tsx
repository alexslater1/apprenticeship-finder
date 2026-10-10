import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { matchTier, type Location } from '@af/shared';
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

const TIER_CLASS = { high: 'af-pin-high', medium: 'af-pin-medium', low: 'af-pin-low' } as const;

type Point = Location & { lat: number; lon: number };

/** One pin per distinct place this job is advertised at. */
function mappable(locations: Location[] | null | undefined): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const l of locations ?? []) {
    if (typeof l.lat !== 'number' || typeof l.lon !== 'number') continue;
    const key = `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l as Point);
  }
  return out;
}

function Fit({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lon], 12);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), { padding: [24, 24] });
  }, [map, points]);
  return null;
}

/** Where this job is (Alex, 10 Oct: the Map tab went; each job gets its own map instead). */
export default function ListingMap({ locations, score }: { locations: Location[]; score: number }) {
  const points = mappable(locations);
  const icon = L.divIcon({
    className: `af-pin ${TIER_CLASS[matchTier(score)]}`,
    iconSize: [18, 18],
  });
  return (
    <MapContainer
      center={[points[0]!.lat, points[0]!.lon]}
      zoom={12}
      scrollWheelZoom={false}
      className="h-56 w-full overflow-hidden rounded-lg border"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points.map((p) => (
        <Marker key={`${p.lat},${p.lon}`} position={[p.lat, p.lon]} icon={icon} title={p.text}>
          <Popup>{p.text}</Popup>
        </Marker>
      ))}
      <Fit points={points} />
    </MapContainer>
  );
}
