-- Trigger functions are internal implementation details, not client-callable RPC endpoints.
revoke all on function public.fn_log_guest_service_request_event() from public, anon, authenticated;
revoke all on function public.fn_validate_guest_service_request() from public, anon, authenticated;
revoke all on function public.fn_touch_guest_service_request_updated_at() from public, anon, authenticated;
