-- Optional "your typical price" per account — anchors price-position analysis
-- ("you are the 3rd cheapest of 9 publishing prices"). Null/blank = no price
-- position reported; the app degrades gracefully until this runs.

alter table public.profiles add column if not exists price_point text;
