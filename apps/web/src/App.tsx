import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/lib/auth';
import Companies from '@/pages/Companies';
import Listings from '@/pages/Listings';
import Login from '@/pages/Login';
import SetPassword from '@/pages/SetPassword';
import Health from '@/pages/Health';
import Hidden from '@/pages/Hidden';
import Settings from '@/pages/Settings';
import Tracker from '@/pages/Tracker';

// Leaflet is big; load the map only when it's opened.
const MapPage = lazy(() => import('@/pages/MapPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 } },
});

function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <HashRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/set-password" element={<SetPassword />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route index element={<Listings />} />
                  <Route path="/listing/:id" element={<Listings />} />
                  <Route
                    path="/map"
                    element={
                      <Suspense
                        fallback={
                          <div className="p-8 text-center text-muted-foreground">Loading map…</div>
                        }
                      >
                        <MapPage />
                      </Suspense>
                    }
                  />
                  <Route path="/tracker" element={<Tracker />} />
                  <Route path="/companies" element={<Companies />} />
                  <Route path="/companies/:id" element={<Companies />} />
                  <Route path="/hidden" element={<Hidden />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/health" element={<Health />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Routes>
          </HashRouter>
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
