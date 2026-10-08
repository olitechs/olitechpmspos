-- Keep internal stock reversal helper private; it is only invoked by approved server-side refund/void logic.
revoke all on function public.fn_reverse_pos_stock(uuid,jsonb,numeric,text) from public,anon,authenticated;
notify pgrst,'reload schema';