-- ============================================================
--  在 Supabase 后台 → SQL Editor 里粘贴执行本脚本（只需一次）
--  建一张表 app_data，用于存放各模块的同步数据。
-- ============================================================

create table if not exists app_data (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- 开启行级安全，并允许匿名读写（本工具为内部小团队共用，免登录）
alter table app_data enable row level security;

drop policy if exists "anon_all_app_data" on app_data;
create policy "anon_all_app_data"
  on app_data for all
  to anon
  using (true)
  with check (true);

-- 给 Supabase 自带的实时功能（可选，页面未强依赖）
alter publication supabase_realtime add table app_data;
