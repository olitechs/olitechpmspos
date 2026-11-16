// Application shell: config gate + global providers. The route table lives in
// src/routes/AppRoutes.jsx (the source of truth audited by scripts/check-links.mjs,
// scripts/audit-links.mjs and the route contract tests).
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router } from "react-router-dom";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import SupabaseSetupNotice from "@/pages/SupabaseSetupNotice";
import ScrollToTop from "@/components/ui/ScrollToTop";
import AppRoutes from "@/routes/AppRoutes";

function App(){if(!isSupabaseConfigured)return <SupabaseSetupNotice/>;return <QueryClientProvider client={queryClientInstance}><Router><ScrollToTop/><Toaster/><AppRoutes/></Router></QueryClientProvider>;}
export default App;
