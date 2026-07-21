# Supabase Setup (hosted, Phase 0)

1. Go to https://supabase.com → New project. Pick a region near you. Save the
   database password.
2. Project Settings → API:
   - Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`.
   - Copy **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Copy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret).
3. Project Settings → Database → Connection string → **URI** (Session pooler is
   fine). Put it in `DATABASE_URL`, inserting your DB password.
4. Auth → Providers → Email: enable. (Phone provider stays OFF in Phase 0 — we
   stub OTP in dev.)
5. Copy `.env.example` to `.env` and paste all four values.
6. Tell your engineer the `.env` is ready.

## Applying schema (engineer runs)

```bash
pnpm --filter @footylocal/db migrate   # Drizzle: tables + enums
pnpm --filter @footylocal/db sql       # PostGIS, RLS, games_near, trigger
pnpm --filter @footylocal/db seed      # 6 verified venues
```

## Verify

In the Supabase SQL editor:

```sql
select count(*) from venues where is_verified;      -- 6
select * from games_near(33.749, -84.388, 20000);   -- runs, returns 0 rows
```
