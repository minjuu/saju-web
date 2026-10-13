-- 계정당 하루 1회 AI 해석 기록 (한국 날짜 기준)
create table if not exists public.reading_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- 정책 없이 RLS만 켜 둔다: 브라우저(anon 키)로는 읽기/쓰기 불가, 서버(service role)만 접근
alter table public.reading_usage enable row level security;
