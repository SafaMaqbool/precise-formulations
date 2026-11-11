-- Products as shown in the brief's mockup. Values marked TBC still need the client's confirmation.
-- Prices are in cents.
DELETE FROM products;
INSERT INTO products (slug, name, tagline, short_label, active_ingredients, strength, size, ingredients, preserved_with, price_cents, sort_order) VALUES
  ('true-hair-growth-serum',    'True Hair Growth Serum',      'GHK-Cu 6%, AHK-Cu 1%',               'Hair',      'GHK-Cu 6%, AHK-Cu 1%',            'GHK-Cu 6%, AHK-Cu 1%',   '30 ml', 'Sterile water, GHK-Cu, AHK-Cu', '0.5% Liquid Germall Plus', 3500, 1),
  ('true-hair-growth-serum-ha', 'True Hair Growth Serum + HA', 'Same formula, with hyaluronic acid', 'Hair + HA', 'GHK-Cu 6%, AHK-Cu 1%, hyaluronic acid', 'GHK-Cu 6%, AHK-Cu 1%', '30 ml', NULL,                            NULL,                       3800, 2),
  ('glass-skin-serum',          'Glass Skin Serum',            'GHK-Cu 3.33%, hyaluronic acid',      'Skin',      'GHK-Cu 3.33%, hyaluronic acid',   'GHK-Cu 3.33%',           '30 ml', NULL,                            NULL,                       3800, 3);
