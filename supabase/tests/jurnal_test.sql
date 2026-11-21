reset role;
-- 028: jurnal pe înțeles (fără nume tehnice)
select tst.assert(activity_field_label('reviewed_by') = 'verificat de' and activity_field_label('rejection_reason') = 'motivul respingerii'
  and activity_field_label('ceva_nou') = 'ceva nou', 'câmpuri traduse');
select tst.assert(activity_value('reviewed_at', '"2026-11-21T11:36:02.610958+00:00"') = '21.11.2026 13:36', 'dată citeață');
select tst.assert(activity_value('status', '"trimis"') = 'trimis spre aprobare', 'stare în cuvinte');
select tst.assert(activity_value('reviewed_by', to_jsonb('00000000-0000-0000-0000-00000000000a'::text)) = 'Dan Admin', 'id → nume persoană');
select tst.assert(activity_summary('Ana', 'time_entries', 'UPDATE', 1,
  '[{"label":"Ion · Lucrare · 21.11 08:00","changes":[{"f":"stare","from":"trimis spre aprobare","to":"respins"},{"f":"verificat de","from":"—","to":"Ana"},{"f":"motivul respingerii","from":"—","to":"Greșeală"}]}]')
  = 'Ana a respins pontajul „Ion · Lucrare · 21.11 08:00” — motiv: Greșeală', 'pontaj respins pe înțeles');
select tst.assert(activity_summary('Ana', 'time_entries', 'UPDATE', 1,
  '[{"label":"X","changes":[{"f":"validat de","from":"—","to":"Ana"},{"f":"validat la","from":"—","to":"21.11.2026 13:36"}]}]')
  = 'Ana a validat pontajul „X”', 'pontaj validat pe înțeles');
reset role;
select 'JURNAL028_TESTE_TRECUTE';
