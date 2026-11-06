-- Rows a production database holds before 20261106007100 (RB-S1, RB-S2, RB-S4):
--  * merchants linked to Salla stores (the link history starts empty), one of them uninstalled /
--    disconnected the base way (tokens gone, store id kept), a parked Easy Mode install;
--  * events logged by the old webhook default branch: the full delivery envelope, including the
--    plaintext app.store.authorize tokens, plus non-Salla events that must stay untouched.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000071a1', 'linked@history.example'),
  ('00000000-0000-4000-8000-0000000071b1', 'uninstalled@history.example'),
  ('00000000-0000-4000-8000-0000000071c1', 'nostore@history.example');

insert into public.merchants (id, owner_user_id, seller_name, salla_merchant_id, access_token, refresh_token, installed_at, uninstalled_at) values
  ('00000000-0000-4000-8000-0000000071a2', '00000000-0000-4000-8000-0000000071a1', 'Linked', '71001',
   'enc:v1:at', 'enc:v1:rt', '2026-10-01T10:00:00Z', null),
  ('00000000-0000-4000-8000-0000000071b2', '00000000-0000-4000-8000-0000000071b1', 'Uninstalled', '71002',
   null, null, '2026-09-01T10:00:00Z', '2026-10-20T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000071c2', '00000000-0000-4000-8000-0000000071c1', 'No store', null,
   null, null, '2026-10-02T10:00:00Z', null);

insert into public.salla_installs (salla_merchant_id, access_token_encrypted, owner_email, owner_role, authorized_at)
values ('71003', 'enc:v1:parked', 'owner@history.example', 'user', '2026-11-01T12:00:00Z');

insert into public.events (id, kind, merchant, payload) values
  (710001, 'app.store.authorize', '71001',
   '{"event":"app.store.authorize","merchant":71001,"created_at":"2026-10-01 13:00:00",
     "data":{"access_token":"PLAINTEXT-ACCESS-71001","expires":1793000000,"refresh_token":"PLAINTEXT-REFRESH-71001","scope":"offline_access","token_type":"bearer"}}'),
  (710002, 'salla.installed', '71001',
   '{"event":"app.installed","merchant":71001,"data":{"id":1,"settings":{"Token":"NESTED-SECRET"}}}'),
  (710003, 'order.updated', '71001',
   '{"event":"order.updated","merchant":71001,"data":{"id":5,"customer":{"email":"buyer@example.test","mobile":"+966500000001"},
     "items":[{"name":"oud","password":"ITEM-SECRET"}]}}'),
  (710004, 'voice.tool_call', '00000000-0000-4000-8000-0000000071a2',
   '{"name":"lookup_order","arguments":{"token":"keep-me"}}'),
  (710005, 'salla.app.store.authorize', '71001', '{"outcome":"linked_updated","scope":"offline_access"}');
