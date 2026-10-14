-- Dynamic Field Manager, part 3.
--   - built-in fields sit in the sections of their form and can be reordered
--     within a section (default_order remembers where the form put them);
--   - the auction / deal fields of a listing and the institutional listing
--     form's own fields are built-in fields too;
--   - approving a listing that lacks required added details is a setting.

ALTER TABLE metadata_fields ADD COLUMN IF NOT EXISTS default_order INTEGER;

UPDATE metadata_fields SET section = 'Listing details', display_order = -1990, default_order = -1990 WHERE is_system AND entity_type = 'property' AND core_key = 'title';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1980, default_order = -1980 WHERE is_system AND entity_type = 'property' AND core_key = 'propertyType';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1970, default_order = -1970 WHERE is_system AND entity_type = 'property' AND core_key = 'transactionType';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1960, default_order = -1960 WHERE is_system AND entity_type = 'property' AND core_key = 'city';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1950, default_order = -1950 WHERE is_system AND entity_type = 'property' AND core_key = 'locality';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1940, default_order = -1940 WHERE is_system AND entity_type = 'property' AND core_key = 'address';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1930, default_order = -1930 WHERE is_system AND entity_type = 'property' AND core_key = 'price';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1920, default_order = -1920 WHERE is_system AND entity_type = 'property' AND core_key = 'areaSqft';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1910, default_order = -1910 WHERE is_system AND entity_type = 'property' AND core_key = 'carpetAreaSqft';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1900, default_order = -1900 WHERE is_system AND entity_type = 'property' AND core_key = 'bedrooms';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1890, default_order = -1890 WHERE is_system AND entity_type = 'property' AND core_key = 'bathrooms';
UPDATE metadata_fields SET section = 'Listing details', display_order = -1880, default_order = -1880 WHERE is_system AND entity_type = 'property' AND core_key = 'facing';
UPDATE metadata_fields SET section = 'Badges and tags', display_order = -1870, default_order = -1870 WHERE is_system AND entity_type = 'property' AND core_key = 'badge';
UPDATE metadata_fields SET section = 'Badges and tags', display_order = -1860, default_order = -1860 WHERE is_system AND entity_type = 'property' AND core_key = 'tags';
UPDATE metadata_fields SET section = 'RERA', display_order = -1850, default_order = -1850 WHERE is_system AND entity_type = 'property' AND core_key = 'reraNumber';
UPDATE metadata_fields SET section = 'Property details', display_order = -1840, default_order = -1840 WHERE is_system AND entity_type = 'property' AND core_key = 'possessionStatus';
UPDATE metadata_fields SET section = 'Property details', display_order = -1830, default_order = -1830 WHERE is_system AND entity_type = 'property' AND core_key = 'floorNumber';
UPDATE metadata_fields SET section = 'Property details', display_order = -1820, default_order = -1820 WHERE is_system AND entity_type = 'property' AND core_key = 'totalFloors';
UPDATE metadata_fields SET section = 'Property details', display_order = -1810, default_order = -1810 WHERE is_system AND entity_type = 'property' AND core_key = 'furnishing';
UPDATE metadata_fields SET section = 'Property details', display_order = -1800, default_order = -1800 WHERE is_system AND entity_type = 'property' AND core_key = 'parkingSpots';
UPDATE metadata_fields SET section = 'Property details', display_order = -1790, default_order = -1790 WHERE is_system AND entity_type = 'property' AND core_key = 'parkingType';
UPDATE metadata_fields SET section = 'Property details', display_order = -1780, default_order = -1780 WHERE is_system AND entity_type = 'property' AND core_key = 'ageOfProperty';
UPDATE metadata_fields SET section = 'Rate and market trends', display_order = -1770, default_order = -1770 WHERE is_system AND entity_type = 'property' AND core_key = 'rate';
UPDATE metadata_fields SET section = 'Rate and market trends', display_order = -1760, default_order = -1760 WHERE is_system AND entity_type = 'property' AND core_key = 'annualAppreciationPercent';
UPDATE metadata_fields SET section = 'Rate and market trends', display_order = -1750, default_order = -1750 WHERE is_system AND entity_type = 'property' AND core_key = 'estimatedRentMonthly';
UPDATE metadata_fields SET section = 'Rate and market trends', display_order = -1740, default_order = -1740 WHERE is_system AND entity_type = 'property' AND core_key = 'localityRating';
UPDATE metadata_fields SET section = 'Listing category', display_order = -1730, default_order = -1730 WHERE is_system AND entity_type = 'property' AND core_key = 'listingCategory';
UPDATE metadata_fields SET section = 'More information', display_order = -1580, default_order = -1580 WHERE is_system AND entity_type = 'property' AND core_key = 'amenities';
UPDATE metadata_fields SET section = 'More information', display_order = -1570, default_order = -1570 WHERE is_system AND entity_type = 'property' AND core_key = 'description';
UPDATE metadata_fields SET section = 'More information', display_order = -1560, default_order = -1560 WHERE is_system AND entity_type = 'property' AND core_key = 'aboutExtended';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1990, default_order = -1990 WHERE is_system AND entity_type = 'requirement' AND core_key = 'purpose';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1980, default_order = -1980 WHERE is_system AND entity_type = 'requirement' AND core_key = 'city';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1970, default_order = -1970 WHERE is_system AND entity_type = 'requirement' AND core_key = 'localities';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1960, default_order = -1960 WHERE is_system AND entity_type = 'requirement' AND core_key = 'propertyType';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1950, default_order = -1950 WHERE is_system AND entity_type = 'requirement' AND core_key = 'bedrooms';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1940, default_order = -1940 WHERE is_system AND entity_type = 'requirement' AND core_key = 'budgetMin';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1930, default_order = -1930 WHERE is_system AND entity_type = 'requirement' AND core_key = 'budgetMax';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1920, default_order = -1920 WHERE is_system AND entity_type = 'requirement' AND core_key = 'areaMinSqft';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1910, default_order = -1910 WHERE is_system AND entity_type = 'requirement' AND core_key = 'areaMaxSqft';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1900, default_order = -1900 WHERE is_system AND entity_type = 'requirement' AND core_key = 'urgency';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1890, default_order = -1890 WHERE is_system AND entity_type = 'requirement' AND core_key = 'amenities';
UPDATE metadata_fields SET section = 'Requirement', display_order = -1880, default_order = -1880 WHERE is_system AND entity_type = 'requirement' AND core_key = 'notes';
UPDATE metadata_fields SET section = 'Lead', display_order = -1990, default_order = -1990 WHERE is_system AND entity_type = 'crm_lead' AND core_key = 'customerId';
UPDATE metadata_fields SET section = 'Lead', display_order = -1980, default_order = -1980 WHERE is_system AND entity_type = 'crm_lead' AND core_key = 'propertyId';
UPDATE metadata_fields SET section = 'Lead', display_order = -1970, default_order = -1970 WHERE is_system AND entity_type = 'crm_lead' AND core_key = 'source';
UPDATE metadata_fields SET section = 'Lead', display_order = -1960, default_order = -1960 WHERE is_system AND entity_type = 'crm_lead' AND core_key = 'assignedTo';

INSERT INTO metadata_fields (entity_type, section, field_name, field_label, default_label, field_type, display_order, default_order, is_system, is_locked, core_key, is_required) VALUES
  ('property', 'Listing category', 'auction_date', 'Auction date and time', 'Auction date and time', 'datetime', -1720, -1720, true, false, 'auctionDate', false),
  ('property', 'Listing category', 'source_bank', 'Source bank', 'Source bank', 'text', -1710, -1710, true, false, 'sourceBank', false),
  ('property', 'Listing category', 'occupancy_percent', 'Occupancy (%)', 'Occupancy (%)', 'decimal', -1700, -1700, true, false, 'occupancyPercent', false),
  ('property', 'Listing category', 'yield_percent', 'Yield (%)', 'Yield (%)', 'decimal', -1690, -1690, true, false, 'yieldPercent', false),
  ('property', 'Listing category', 'yield_qualifier', 'Yield qualifier', 'Yield qualifier', 'text', -1680, -1680, true, false, 'yieldQualifier', false),
  ('property', 'Deal details', 'opportunity_source_type', 'Deal source', 'Deal source', 'dropdown', -1670, -1670, true, false, 'opportunitySourceType', false),
  ('property', 'Deal details', 'reserve_price', 'Reserve / asking price', 'Reserve / asking price', 'currency', -1660, -1660, true, false, 'reservePrice', false),
  ('property', 'Deal details', 'estimated_market_value', 'Estimated market value', 'Estimated market value', 'currency', -1650, -1650, true, false, 'estimatedMarketValue', false),
  ('property', 'Deal details', 'possession_type', 'Possession', 'Possession', 'dropdown', -1640, -1640, true, false, 'possessionType', false),
  ('property', 'Deal details', 'inspection_date', 'Inspection date', 'Inspection date', 'datetime', -1630, -1630, true, false, 'inspectionDate', false),
  ('property', 'Deal details', 'emd_amount', 'EMD amount', 'EMD amount', 'currency', -1620, -1620, true, false, 'emdAmount', false),
  ('property', 'Deal details', 'emd_deadline', 'EMD deadline', 'EMD deadline', 'datetime', -1610, -1610, true, false, 'emdDeadline', false),
  ('property', 'Deal details', 'auction_reference_id', 'Auction reference / ID', 'Auction reference / ID', 'text', -1600, -1600, true, false, 'auctionReferenceId', false),
  ('property', 'Deal details', 'auction_portal_url', 'Auction portal link', 'Auction portal link', 'text', -1590, -1590, true, false, 'auctionPortalUrl', false),
  ('institution', 'The institution', 'institution_name', 'Institution name', 'Institution name', 'text', -1990, -1990, true, true, 'institutionName', true),
  ('institution', 'The institution', 'asset_class', 'Type', 'Type', 'dropdown', -1980, -1980, true, true, 'assetClass', true),
  ('institution', 'The institution', 'board_affiliation', 'Board / affiliation or category', 'Board / affiliation or category', 'text', -1970, -1970, true, false, 'boardAffiliation', false),
  ('institution', 'The institution', 'year_established', 'Year established', 'Year established', 'number', -1960, -1960, true, false, 'yearEstablished', false),
  ('institution', 'The institution', 'student_enrollment', 'Students enrolled / capacity', 'Students enrolled / capacity', 'number', -1950, -1950, true, false, 'studentEnrollment', false),
  ('institution', 'The institution', 'faculty_count', 'Faculty / staff', 'Faculty / staff', 'number', -1940, -1940, true, false, 'facultyCount', false),
  ('institution', 'Location and campus', 'city', 'City', 'City', 'text', -1930, -1930, true, true, 'city', true),
  ('institution', 'Location and campus', 'locality', 'Locality', 'Locality', 'text', -1920, -1920, true, false, 'locality', false),
  ('institution', 'Location and campus', 'address', 'Address', 'Address', 'text', -1910, -1910, true, false, 'address', false),
  ('institution', 'Location and campus', 'latitude', 'Latitude', 'Latitude', 'decimal', -1900, -1900, true, true, 'latitude', true),
  ('institution', 'Location and campus', 'longitude', 'Longitude', 'Longitude', 'decimal', -1890, -1890, true, true, 'longitude', true),
  ('institution', 'Location and campus', 'campus_area_acres', 'Campus area (acres)', 'Campus area (acres)', 'decimal', -1880, -1880, true, false, 'campusAreaAcres', false),
  ('institution', 'Location and campus', 'built_up_area_sqft', 'Built-up area (sq ft)', 'Built-up area (sq ft)', 'decimal', -1870, -1870, true, false, 'builtUpAreaSqft', false),
  ('institution', 'Location and campus', 'infrastructure', 'Infrastructure', 'Infrastructure', 'textarea', -1860, -1860, true, false, 'infrastructure', false),
  ('institution', 'Approvals and land', 'noc_status', 'NOC status', 'NOC status', 'dropdown', -1850, -1850, true, false, 'nocStatus', false),
  ('institution', 'Approvals and land', 'land_ownership', 'Land ownership', 'Land ownership', 'dropdown', -1840, -1840, true, false, 'landOwnership', false),
  ('institution', 'The transaction', 'deal_type', 'Transaction', 'Transaction', 'dropdown', -1830, -1830, true, true, 'dealType', true),
  ('institution', 'The transaction', 'asking_price_cr', 'Asking price', 'Asking price', 'currency', -1820, -1820, true, true, 'askingPriceCr', true),
  ('institution', 'The transaction', 'annual_revenue_cr', 'Annual revenue', 'Annual revenue', 'currency', -1810, -1810, true, false, 'annualRevenueCr', false),
  ('institution', 'The transaction', 'ebitda_cr', 'EBITDA', 'EBITDA', 'currency', -1800, -1800, true, false, 'ebitdaCr', false)
ON CONFLICT (entity_type, field_name) DO NOTHING;

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('fields.block_approval_when_incomplete', 'true', 'fields', 'Refuse to approve a listing that lacks details the Super Admin made required in the Field Manager')
ON CONFLICT (config_key) DO NOTHING;
