-- PLACEHOLDER products. Replace names, ingredients, strength, size and prices
-- once the client sends final product details.
DELETE FROM products;
INSERT INTO products (slug, name, tagline, active_ingredients, strength, size, price_cents, sort_order) VALUES
  ('product-one',   'Product One',   'Placeholder tagline', 'Ingredient A, Ingredient B', 'TBC', '30 ml', 0, 1),
  ('product-two',   'Product Two',   'Placeholder tagline', 'Ingredient C',               'TBC', '30 ml', 0, 2),
  ('product-three', 'Product Three', 'Placeholder tagline', 'Ingredient D',               'TBC', '30 ml', 0, 3);
