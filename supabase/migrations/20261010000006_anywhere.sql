-- "Happy to move anywhere": no travel distance (null) means distance never affects the score.
alter table public.settings alter column default_distance_miles drop not null;
-- Location doesn't matter: he'd move away from home.
update public.settings set default_distance_miles = null where id = 1;
