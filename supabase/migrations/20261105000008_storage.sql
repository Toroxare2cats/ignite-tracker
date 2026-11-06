-- =============================================================================
-- 0008 Storage buckets and their rules.
--
--   design-photos : everyone signed in reads, managers write.
--   receipts      : an artist uploads into a folder named after their own
--                   account id and reads only that folder; managers read all.
-- Both buckets are private; the app fetches files with short-lived signed URLs.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('design-photos', 'design-photos', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('receipts', 'receipts', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'text/plain'])
on conflict (id) do nothing;

-- design-photos ---------------------------------------------------------------
create policy "design-photos: everyone reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'design-photos' and (select app.is_active_user()));

create policy "design-photos: managers upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'design-photos' and (select app.is_manager()));

create policy "design-photos: managers update"
  on storage.objects for update to authenticated
  using (bucket_id = 'design-photos' and (select app.is_manager()))
  with check (bucket_id = 'design-photos' and (select app.is_manager()));

create policy "design-photos: managers delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'design-photos' and (select app.is_manager()));

-- receipts --------------------------------------------------------------------
create policy "receipts: own folder or manager reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and ((select app.is_manager()) or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "receipts: own folder upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (select app.is_active_user())
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "receipts: managers delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (select app.is_manager()));
