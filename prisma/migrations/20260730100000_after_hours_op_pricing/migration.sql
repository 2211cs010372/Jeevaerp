-- AFTER-HOURS OP: the evening clinic closes, the price changes.
--
-- After the OP clinic shuts, a doctor who sees a patient has been called in.
-- The visit is an EMERGENCY and it carries a higher consultation fee - commonly
-- double the day fee. Until now the desk had to remember that and edit the bill
-- by hand, which means it was remembered unevenly.
--
-- Four additive columns, all with defaults, so an existing row needs no
-- backfill and nothing that runs today changes shape.
--
-- Why a MULTIPLIER and not a flat after-hours amount: the day fee lives on each
-- Doctor and differs between them. A ₹500 physician and a ₹900 specialist must
-- both become "double" - one shared flat figure would quietly overcharge for
-- one of them and undercharge for the other, and nobody would notice which.
--
-- Why the window is two "HH:MM" strings and not an hour number: it has to be
-- able to cross midnight. afterHoursOpEnd EARLIER than afterHoursOpStart means
-- exactly that (20:00 → 06:00 covers the 2 AM visit), and an integer cutoff
-- with no end could not express it.
--
-- Defaults chosen as 20:00–06:00 at 2×: the hospital's stated practice. All
-- four are editable in Admin → Settings, so moving the cutoff to 21:00 is a
-- decision somebody makes on a screen, not a code change.

ALTER TABLE "HospitalConfig"
  ADD COLUMN "afterHoursOpEnabled"    BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN "afterHoursOpStart"      TEXT         NOT NULL DEFAULT '20:00',
  ADD COLUMN "afterHoursOpEnd"        TEXT         NOT NULL DEFAULT '06:00',
  ADD COLUMN "afterHoursOpMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 2;
