-- Distinguish scan-sourced facts from manually entered ones.
-- Merge policy: manual entries always win. A scan never overwrites a manual
-- fact; it fills gaps (status='unknown'), refreshes its own stale values, and
-- flags genuine changes as needs_review for the user to confirm.

alter table public.competitor_facts
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'scan'));

create index if not exists competitor_facts_origin_idx
  on public.competitor_facts (business_id, origin);
