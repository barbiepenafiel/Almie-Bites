-- =====================================================================
-- Almie Bites — Storage buckets for expense receipts and business logo.
-- Files are stored under "<user id>/<file name>" so each owner can only
-- touch their own folder.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('branding', 'branding', true,  2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

-- Receipts (private)
create policy "receipts: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "receipts: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "receipts: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "receipts: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Branding (public read, owner write)
create policy "branding: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "branding: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "branding: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and (storage.foldername(name))[1] = (select auth.uid())::text);
