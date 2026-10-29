-- Tag.color: a "#rrggbb" colour. Every tag starts as indigo (#343ca6), the colour all tags had
-- before. The Worker checks the format, so there is no CHECK here.

ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT '#343ca6';
