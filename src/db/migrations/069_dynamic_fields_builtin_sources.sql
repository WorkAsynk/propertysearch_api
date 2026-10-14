-- Dynamic Field Manager, part 2.
--   - the built-in fields of the property, requirement and lead forms are
--     rows in metadata_fields too (is_system): the Super Admin can relabel
--     them, add help text, make them required or hide them. The ones a record
--     cannot exist without are locked (never hidden).
--   - a dropdown can take its options from master data (options_source)
--     instead of a typed list.

ALTER TABLE metadata_fields
  ADD COLUMN IF NOT EXISTS is_system      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_locked      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS core_key       VARCHAR(60),
  ADD COLUMN IF NOT EXISTS default_label  VARCHAR(150),
  ADD COLUMN IF NOT EXISTS options_source VARCHAR(40);

INSERT INTO metadata_fields (entity_type, section, field_name, field_label, default_label, field_type, display_order, is_system, is_locked, core_key, is_required) VALUES
  ('property', 'Built-in', 'title', 'Title', 'Title', 'text', -990, true, true, 'title', true),
  ('property', 'Built-in', 'property_type', 'Property type', 'Property type', 'dropdown', -980, true, true, 'propertyType', true),
  ('property', 'Built-in', 'transaction_type', 'Transaction type', 'Transaction type', 'dropdown', -970, true, true, 'transactionType', true),
  ('property', 'Built-in', 'price', 'Price', 'Price', 'text', -960, true, true, 'price', true),
  ('property', 'Built-in', 'city', 'City', 'City', 'text', -950, true, true, 'city', true),
  ('property', 'Built-in', 'listing_category', 'Category', 'Category', 'dropdown', -940, true, true, 'listingCategory', true),
  ('property', 'Built-in', 'locality', 'Locality', 'Locality', 'text', -930, true, false, 'locality', false),
  ('property', 'Built-in', 'address', 'Address', 'Address', 'text', -920, true, false, 'address', false),
  ('property', 'Built-in', 'area_sqft', 'Built-up area (sq ft)', 'Built-up area (sq ft)', 'decimal', -910, true, false, 'areaSqft', false),
  ('property', 'Built-in', 'carpet_area_sqft', 'Carpet area (sq ft)', 'Carpet area (sq ft)', 'decimal', -900, true, false, 'carpetAreaSqft', false),
  ('property', 'Built-in', 'bedrooms', 'Bedrooms', 'Bedrooms', 'number', -890, true, false, 'bedrooms', false),
  ('property', 'Built-in', 'bathrooms', 'Bathrooms', 'Bathrooms', 'number', -880, true, false, 'bathrooms', false),
  ('property', 'Built-in', 'facing', 'Facing', 'Facing', 'text', -870, true, false, 'facing', false),
  ('property', 'Built-in', 'furnishing', 'Furnishing', 'Furnishing', 'dropdown', -860, true, false, 'furnishing', false),
  ('property', 'Built-in', 'floor_number', 'Floor number', 'Floor number', 'number', -850, true, false, 'floorNumber', false),
  ('property', 'Built-in', 'total_floors', 'Total floors', 'Total floors', 'number', -840, true, false, 'totalFloors', false),
  ('property', 'Built-in', 'possession_status', 'Possession status', 'Possession status', 'dropdown', -830, true, false, 'possessionStatus', false),
  ('property', 'Built-in', 'parking_spots', 'Parking spots', 'Parking spots', 'number', -820, true, false, 'parkingSpots', false),
  ('property', 'Built-in', 'parking_type', 'Parking type', 'Parking type', 'text', -810, true, false, 'parkingType', false),
  ('property', 'Built-in', 'age_of_property', 'Age of property', 'Age of property', 'text', -800, true, false, 'ageOfProperty', false),
  ('property', 'Built-in', 'rera_number', 'RERA number', 'RERA number', 'text', -790, true, false, 'reraNumber', false),
  ('property', 'Built-in', 'amenities', 'Amenities', 'Amenities', 'multiselect', -780, true, false, 'amenities', false),
  ('property', 'Built-in', 'description', 'Description', 'Description', 'textarea', -770, true, false, 'description', false),
  ('property', 'Built-in', 'about_extended', 'Additional details', 'Additional details', 'textarea', -760, true, false, 'aboutExtended', false),
  ('property', 'Built-in', 'badge', 'Badge', 'Badge', 'text', -750, true, false, 'badge', false),
  ('property', 'Built-in', 'tags', 'Tags', 'Tags', 'multiselect', -740, true, false, 'tags', false),
  ('property', 'Built-in', 'rate', 'Rate (per sq ft)', 'Rate (per sq ft)', 'currency', -730, true, false, 'rate', false),
  ('property', 'Built-in', 'annual_appreciation_percent', 'Annual appreciation (%)', 'Annual appreciation (%)', 'decimal', -720, true, false, 'annualAppreciationPercent', false),
  ('property', 'Built-in', 'estimated_rent_monthly', 'Estimated rent (per month)', 'Estimated rent (per month)', 'currency', -710, true, false, 'estimatedRentMonthly', false),
  ('property', 'Built-in', 'locality_rating', 'Locality rating', 'Locality rating', 'decimal', -700, true, false, 'localityRating', false),
  ('requirement', 'Built-in', 'purpose', 'Buy or rent', 'Buy or rent', 'dropdown', -990, true, true, 'purpose', true),
  ('requirement', 'Built-in', 'city', 'City', 'City', 'text', -980, true, true, 'city', true),
  ('requirement', 'Built-in', 'property_type', 'Property type', 'Property type', 'dropdown', -970, true, false, 'propertyType', false),
  ('requirement', 'Built-in', 'localities', 'Preferred localities', 'Preferred localities', 'multiselect', -960, true, false, 'localities', false),
  ('requirement', 'Built-in', 'budget_min', 'Budget from', 'Budget from', 'currency', -950, true, false, 'budgetMin', false),
  ('requirement', 'Built-in', 'budget_max', 'Budget up to', 'Budget up to', 'currency', -940, true, false, 'budgetMax', false),
  ('requirement', 'Built-in', 'bedrooms', 'Bedrooms', 'Bedrooms', 'number', -930, true, false, 'bedrooms', false),
  ('requirement', 'Built-in', 'area_min_sqft', 'Area from (sq ft)', 'Area from (sq ft)', 'decimal', -920, true, false, 'areaMinSqft', false),
  ('requirement', 'Built-in', 'area_max_sqft', 'Area up to (sq ft)', 'Area up to (sq ft)', 'decimal', -910, true, false, 'areaMaxSqft', false),
  ('requirement', 'Built-in', 'urgency', 'How soon', 'How soon', 'dropdown', -900, true, false, 'urgency', false),
  ('requirement', 'Built-in', 'notes', 'Notes', 'Notes', 'textarea', -890, true, false, 'notes', false),
  ('requirement', 'Built-in', 'amenities', 'Amenities', 'Amenities', 'multiselect', -880, true, false, 'amenities', false),
  ('crm_lead', 'Built-in', 'customer_id', 'Customer', 'Customer', 'dropdown', -990, true, true, 'customerId', true),
  ('crm_lead', 'Built-in', 'source', 'Source', 'Source', 'dropdown', -980, true, true, 'source', true),
  ('crm_lead', 'Built-in', 'property_id', 'Interested property', 'Interested property', 'dropdown', -970, true, false, 'propertyId', false),
  ('crm_lead', 'Built-in', 'assigned_to', 'Assign to', 'Assign to', 'dropdown', -960, true, false, 'assignedTo', false)
ON CONFLICT (entity_type, field_name) DO NOTHING;
