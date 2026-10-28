import { useLocation } from 'react-router-dom';

/** Test helper: prints the current path + query so tests can assert navigation. */
export default function LocationProbe() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}
