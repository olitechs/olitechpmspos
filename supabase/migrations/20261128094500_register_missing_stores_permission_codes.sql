-- Register permission codes referenced by Stores lifecycle guards.
-- Without catalog rows, property owners (who are allowed all catalogued codes)
-- and staff with the corresponding grants fail fn_stores_assert_any checks.
INSERT INTO public.employee_permission_codes
  (code, workspace, label, sensitive, sort_order)
VALUES
  ('stores.requisition.view', 'store', 'View stock requisitions', false, 40),
  ('stores.requisition.create', 'store', 'Create stock requisitions', false, 41),
  ('stores.requisition.approve', 'store', 'Approve stock requisitions', true, 42),
  ('stores.requisition.issue', 'store', 'Issue approved requisitions', true, 43),
  ('stores.requisition.receive', 'store', 'Confirm requisition receipt', true, 44),
  ('stores.issue.void', 'store', 'Void stock issue notes', true, 45),
  ('stores.costcentre.manage', 'store', 'Manage Stores cost centres and settings', true, 46)
ON CONFLICT (code) DO UPDATE
SET workspace = EXCLUDED.workspace,
    label = EXCLUDED.label,
    sensitive = EXCLUDED.sensitive,
    sort_order = EXCLUDED.sort_order;
