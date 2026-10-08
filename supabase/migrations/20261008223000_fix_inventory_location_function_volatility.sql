-- Correct PostgreSQL volatility for the inventory-location bootstrap function.
-- The function creates inventory locations and stock-location rows, so it is
-- mutating and must be VOLATILE (PostgreSQL's default for write-capable functions).

alter function public.fn_ensure_inventory_locations(uuid)
  volatility volatile;

notify pgrst, 'reload schema';
