-- "4 Diamonds" on the inventory sheet and "Love for Diamonds" in the session
-- programs are one game, confirmed by Angela and corroborated by the ticket
-- count: both are 780.
--
-- C860 was a placeholder created when the name appeared in a program and matched
-- nothing — no distributor, no price, no stock. Meanwhile P003 held five boxes at
-- Santa Clara that nothing was ever played from. Two Santa Clara plays had been
-- recorded as never-received against the placeholder while the real boxes sat on
-- the shelf under the other name.
--
-- P003 wins the record because it carries the stock, the distributor and the
-- $45.90 price; it takes the programs' name, since that is what staff write down.
-- Redwood City genuinely had none, so its one play stays a shortfall.

update products
   set name = 'Love for Diamonds',
       aliases = array['4 Diamonds','4 Diamonds 780/$1']
 where id = 'P003';

update session_plays set product_id = 'P003' where product_id = 'C860';

-- the box state machine only allows in_inventory -> opened -> sold_out, so the
-- two real boxes are walked through it rather than jumped
with ghost as (select id, session_id, opened_session, row_number() over (order by id) rn
               from boxes where product_id='C860' and hall_id='sc'),
     real_box as (select id, row_number() over (order by id) rn
                  from boxes where product_id='P003' and hall_id='sc' and state='in_inventory'),
     pairs as (select g.session_id, g.opened_session, r.id as box_id
               from ghost g join real_box r on r.rn = g.rn)
update boxes b set state='opened', session_id=pairs.session_id,
       opened_session=pairs.opened_session, opened_at=now()
  from pairs where b.id = pairs.box_id;

update boxes set state='sold_out', sold_out_at=now()
 where product_id='P003' and hall_id='sc' and state='opened';

delete from boxes where product_id='C860' and hall_id='sc';
update boxes set product_id='P003' where product_id='C860';
delete from products where id='C860';
