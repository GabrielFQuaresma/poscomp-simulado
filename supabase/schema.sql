-- Schema da sincronia entre dispositivos (docs/handoff-sincronia.md).
-- Aplicado no projeto Supabase `poscomp-simulado`. Versionado aqui para que o
-- banco possa ser recriado do zero sem depender do que ficou no dashboard.

-- Historico: uma linha por usuario, o AppData inteiro em jsonb. Nao normalize
-- em tabelas: o app sempre carrega tudo de uma vez e nunca consulta no
-- servidor, entao normalizar so custaria codigo.
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

drop policy if exists user_data_own on public.user_data;
create policy user_data_own on public.user_data
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Rascunhos: um arquivo JSON por sessao, em {user_id}/{session_id}.json.
-- O prefixo da pasta ser o user_id nao e cosmetico: e o que a policy abaixo
-- usa para impedir leitura cruzada. Mantenha a convencao de caminho.
insert into storage.buckets (id, name, public)
values ('scratch', 'scratch', false)
on conflict (id) do nothing;

drop policy if exists scratch_own on storage.objects;
create policy scratch_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'scratch'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'scratch'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
