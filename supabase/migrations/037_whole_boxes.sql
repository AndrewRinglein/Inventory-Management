-- Whole boxes, per Angela: a case that has been opened but is still being used
-- is still one whole box on the count. That is what the charities are told, so
-- that is what the system holds — no fractions anywhere.
--
-- Nine rows on the July sheet were counted as part cases, eight of them cherry
-- tickets, which makes sense: a cherry case is around 10,000 tickets at $428 and
-- sits open for weeks. They were carried at the value of the part held ($107 for
-- a quarter of Bank Buster). They now carry the full case price.
--
-- 1.33 cases of Monopoly Cherry is one full case plus one open and in use, so it
-- becomes two boxes rather than one.

update boxes b set cost = p.base_cost
  from products p
 where b.product_id = p.id and b.hall_id='sc'
   and b.po_id is null and b.delivery_id is null
   and p.id in ('P155','P156','P157','P158','P159','P162','P279','P280','P282');

insert into boxes (hall_id, product_id, cost, state, ordered_at, received_at)
select 'sc','P155',432.00,'in_inventory','2026-07-01T12:00:00Z','2026-07-01T12:00:00Z';

-- Hot Dog and Lucky Dragon are typed flash, so 033's strip revaluation skipped
-- them and they kept the $512 case price. Same no-multiplier rule: $64 a pack.
update boxes b set cost = p.base_cost from products p
 where b.product_id=p.id and p.id in ('P298','P304') and b.hall_id='sc'
   and b.po_id is null and b.delivery_id is null;

-- and these still carried the pre-invoice $77.70
update boxes b set cost = 77.60 from products p
 where b.product_id=p.id and p.id='P036' and b.hall_id='sc'
   and b.po_id is null and b.delivery_id is null;
