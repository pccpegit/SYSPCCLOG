import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ErrorBoundary from '../ui/ErrorBoundary';
import PageLoader from '../ui/PageLoader';

/**
 * SYSPCC-036: `<Outlet />` for the shells' main area. Pages are lazy-loaded, so
 * this keeps the sidebar and header on screen while a page chunk loads (or
 * fails to load) instead of replacing the whole app with a spinner.
 */
export default function RouteOutlet() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );
}
