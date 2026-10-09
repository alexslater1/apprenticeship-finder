import { useMatch, useNavigate, useSearchParams } from 'react-router';
import { useListingData } from '@/lib/useListingData';
import { ListingDetail } from './ListingDetail';

export function DetailHost() {
  const routeId = useMatch('/listing/:id')?.params.id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get('open') ?? routeId;
  const { derived } = useListingData();
  const d = id ? derived.find((x) => x.row.id === id) : undefined;

  const close = () => {
    if (routeId) navigate('/');
    else {
      params.delete('open');
      setParams(params);
    }
  };

  return <ListingDetail d={d} onClose={close} />;
}
