import { QueryClient } from '@tanstack/react-query';

// Single shared React Query client for the app.
// Query boundaries and mutation lifecycles are documented per-feature,
// following the pattern: useQuery/useMutation hooks call service methods,
// errors are surfaced to the UI, and stale data is refreshed on reconnect.
// See Phase 1: Query/Mutation Boundary documentation.

// Default query options:
// - retry: 1 (fail fast, let user retry explicitly)
// - refetchOnWindowFocus: false (avoid surprise refetches during navigation)
// - staleTime: 30_000 (30s — balance freshness vs network cost)
// - gcTime: 24h (React Query v5 name; keep inactive queries in memory for session restore)
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
			staleTime: 30_000,
			gcTime: 86_400_000,
		},
		mutations: {
			retry: false, // financial transactions must not auto-retry
		},
	},
});
