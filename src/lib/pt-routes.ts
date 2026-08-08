// Maps a Perusahaan's `Kode` (Postgres perusahaan.kode / DashboardPerusahaan.Kode)
// to the route tree that PT's dashboard lives under. Each PT is its own
// separate route tree with its own DB wiring — there is no single
// dynamic, company-parametrized dashboard — so switching PT means
// navigating here, not mutating any session/request state.
export const PT_ROUTES: Record<string, string> = {
  mkesindo: "/",
  pmputra: "/pmputra",
};
