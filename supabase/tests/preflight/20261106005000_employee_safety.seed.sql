-- Production-like rows written before 20261106005000_employee_safety.sql:
--  * open tasks the model created (escalations, invoice drafts, follow-ups, free-form), a
--    closed one, a merchant-written one and the hire-time onboarding task;
--  * an employee whose config was written oversized straight through the Data API.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000f501', 'preflight-safety@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f501', 'Preflight Safety');
insert into public.ai_employees (id, merchant_id, role_id, display_name, config) values
  ('00000000-0000-4000-8000-00000000f503', '00000000-0000-4000-8000-00000000f502', 'sales-rep', 'Normal', '{"persona_name":"Layla"}'),
  ('00000000-0000-4000-8000-00000000f504', '00000000-0000-4000-8000-00000000f502', 'support-agent', 'Bloated',
   jsonb_build_object('persona_background', repeat('x', 40000)));

insert into public.ai_employee_tasks (id, employee_id, title, source, status) values
  ('00000000-0000-4000-8000-00000000f511', '00000000-0000-4000-8000-00000000f503', 'Escalate to human: legal threat', 'autonomous', 'todo'),
  ('00000000-0000-4000-8000-00000000f512', '00000000-0000-4000-8000-00000000f503', 'Issue ZATCA invoice (1150 SAR)', 'autonomous', 'todo'),
  ('00000000-0000-4000-8000-00000000f513', '00000000-0000-4000-8000-00000000f503', 'Follow up with +966500000001', 'autonomous', 'in_progress'),
  ('00000000-0000-4000-8000-00000000f514', '00000000-0000-4000-8000-00000000f503', 'Send the catalogue to +15550009999', 'autonomous', 'todo'),
  ('00000000-0000-4000-8000-00000000f515', '00000000-0000-4000-8000-00000000f503', 'Escalate to human: old', 'autonomous', 'done'),
  ('00000000-0000-4000-8000-00000000f516', '00000000-0000-4000-8000-00000000f503', 'Prepare the weekly report', 'user', 'todo'),
  ('00000000-0000-4000-8000-00000000f517', '00000000-0000-4000-8000-00000000f503', 'Onboarding: connect your first channel', 'system', 'todo');
