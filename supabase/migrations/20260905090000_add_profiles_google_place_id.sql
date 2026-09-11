-- Matched Google Places ID for the business's own listing. Persisted after a
-- successful scan so own-listing lookups key on the place ID instead of the
-- typed business name — immune to name drift, typos, and rebrands. Null =
-- not matched yet; the next scan keeps trying by name and stores the ID on
-- its first success.
alter table public.profiles add column if not exists google_place_id text;
