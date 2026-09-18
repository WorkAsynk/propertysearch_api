const searchService = require('../services/search.service');
const { success } = require('../utils/response');

// GET /api/search/properties
async function searchProperties(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const filters = {
      city: req.query.city,
      locality: req.query.locality,
      propertyType: req.query.propertyType,
      transactionType: req.query.transactionType,
      minRate: req.query.minRate,
      maxRate: req.query.maxRate,
      amenities: req.query.amenities
        ? String(req.query.amenities).split(',').map((a) => a.trim())
        : undefined,
    };

    const { items, pagination } = await searchService.searchProperties(
      filters,
      page,
      limit,
      req.query.sort
    );

    return success(res, 200, 'Properties fetched successfully', { items, pagination });
  } catch (err) {
    next(err);
  }
}

// GET /api/search/filters
async function getFilters(req, res, next) {
  try {
    const filters = await searchService.getFilterOptions();
    return success(res, 200, 'Filter options fetched successfully', filters);
  } catch (err) {
    next(err);
  }
}

// GET /api/search/suggestions
async function getSuggestions(req, res, next) {
  try {
    const suggestions = await searchService.getSuggestions(req.query.q);
    return success(res, 200, 'Suggestions fetched successfully', suggestions);
  } catch (err) {
    next(err);
  }
}

// GET /api/search/properties/:id
async function getProperty(req, res, next) {
  try {
    const property = await searchService.getPublicPropertyById(req.params.id);
    return success(res, 200, 'Property fetched successfully', property);
  } catch (err) {
    next(err);
  }
}

module.exports = { searchProperties, getFilters, getSuggestions, getProperty };
