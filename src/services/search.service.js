const { Product, Category, Vendor, User, Rental } = require('../models');
const { AppError } = require('../utils/AppError');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const natural = require('natural');
const compromise = require('compromise');
const Fuse = require('fuse.js');

class SearchService {
  constructor() {
    this.redisClient = getRedisClient();
    this.cacheTTL = 300; // 5 minutes
    
    // Initialize NLP tools
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.TfIdf = natural.TfIdf;
    this.fuseOptions = {
      includeScore: true,
      includeMatches: true,
      threshold: 0.3,
      distance: 100,
      keys: ['name', 'description', 'brand', 'category']
    };

    // Search weights for relevance scoring
    this.weights = {
      name: 10,
      description: 3,
      brand: 5,
      category: 4,
      tags: 6,
      popularity: 2,
      rating: 3,
      availability: 1
    };
  }

  /**
   * Advanced product search
   */
  async searchProducts(query, filters = {}, page = 1, limit = 20) {
    try {
      const cacheKey = this.generateSearchCacheKey('products', query, filters, page, limit);
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const skip = (page - 1) * limit;

      // Build search pipeline
      const pipeline = [];

      // Text search stage
      if (query && query.trim()) {
        const searchTerms = this.processSearchQuery(query);
        pipeline.push(...this.buildTextSearchStage(searchTerms));
      }

      // Filter stage
      const matchStage = this.buildFilterStage(filters);
      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }

      // Lookup stages for related data
      pipeline.push(
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'categoryInfo'
          }
        },
        { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'vendors',
            localField: 'vendor',
            foreignField: 'user',
            as: 'vendorInfo'
          }
        },
        { $unwind: { path: '$vendorInfo', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'reviews',
            localField: '_id',
            foreignField: 'product',
            as: 'reviews'
          }
        }
      );

      // Calculate relevance score
      if (query && query.trim()) {
        pipeline.push(this.buildRelevanceScoreStage(query));
      }

      // Add computed fields
      pipeline.push({
        $addFields: {
          searchScore: query && query.trim() ? { $ifNull: ['$relevanceScore', 0] } : 1,
          averageRating: { $avg: '$reviews.ratings.overall' },
          reviewCount: { $size: '$reviews' },
          inStock: { $gt: ['$inventory.availableQuantity', 0] }
        }
      });

      // Sort stage
      pipeline.push(this.buildSortStage(filters.sort, query));

      // Pagination
      pipeline.push(
        { $skip: skip },
        { $limit: limit }
      );

      // Project final fields
      pipeline.push({
        $project: {
          _id: 1,
          name: '$basicInfo.name',
          slug: '$basicInfo.slug',
          description: '$basicInfo.description',
          brand: '$basicInfo.brand',
          images: '$media.images',
          monthlyRent: '$pricing.monthlyRent',
          securityDeposit: '$pricing.securityDeposit',
          condition: 1,
          category: {
            id: '$categoryInfo._id',
            name: '$categoryInfo.name',
            slug: '$categoryInfo.slug'
          },
          vendor: {
            id: '$vendorInfo.user',
            name: '$vendorInfo.business.name',
            rating: '$vendorInfo.performance.rating.average'
          },
          availability: '$inventory.availableQuantity',
          rating: '$averageRating',
          reviewCount: 1,
          inStock: 1,
          searchScore: 1,
          tags: 1,
          specifications: 1,
          rentalTerms: 1
        }
      });

      // Get total count
      const countPipeline = [...pipeline];
      countPipeline.splice(countPipeline.length - 3, 3); // Remove skip, limit, project
      countPipeline.push({ $count: 'total' });

      const [results, countResult] = await Promise.all([
        Product.aggregate(pipeline),
        Product.aggregate(countPipeline)
      ]);

      const total = countResult[0]?.total || 0;

      // Get facet counts for filters
      const facets = await this.getSearchFacets(query, filters);

      const searchResults = {
        results,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        facets,
        query: query || '',
        filters
      };

      // Cache the results
      if (this.redisClient && results.length > 0) {
        await this.redisClient.setex(cacheKey, this.cacheTTL, JSON.stringify(searchResults));
      }

      return searchResults;
    } catch (error) {
      logger.error('Error in searchProducts:', error);
      throw error;
    }
  }

  /**
   * Build text search stage
   */
  buildTextSearchStage(searchTerms) {
    const shouldConditions = [];

    // Exact phrase match (highest weight)
    if (searchTerms.original) {
      shouldConditions.push({
        $match: {
          $or: [
            { 'basicInfo.name': { $regex: searchTerms.original, $options: 'i' } },
            { 'basicInfo.description': { $regex: searchTerms.original, $options: 'i' } }
          ]
        }
      });
    }

    // Word-by-word search
    if (searchTerms.words.length > 0) {
      const wordConditions = searchTerms.words.map(word => ({
        $or: [
          { 'basicInfo.name': { $regex: word, $options: 'i' } },
          { 'basicInfo.description': { $regex: word, $options: 'i' } },
          { 'basicInfo.brand': { $regex: word, $options: 'i' } },
          { tags: { $in: [new RegExp(word, 'i')] } }
        ]
      }));

      shouldConditions.push({ $or: wordConditions });
    }

    // Stemmed words for broader matching
    if (searchTerms.stems.length > 0) {
      const stemConditions = searchTerms.stems.map(stem => ({
        $or: [
          { 'basicInfo.name': { $regex: stem, $options: 'i' } },
          { 'basicInfo.description': { $regex: stem, $options: 'i' } }
        ]
      }));

      shouldConditions.push({ $or: stemConditions });
    }

    // Category matching
    if (searchTerms.categories.length > 0) {
      shouldConditions.push({
        'categoryInfo.name': { $in: searchTerms.categories }
      });
    }

    return [
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: shouldConditions
        }
      }
    ];
  }

  /**
   * Build relevance score stage
   */
  buildRelevanceScoreStage(query) {
    const searchTerms = this.processSearchQuery(query);
    
    return {
      $addFields: {
        relevanceScore: {
          $add: [
            // Name match (highest weight)
            {
              $multiply: [
                {
                  $cond: [
                    { $regexMatch: { input: '$basicInfo.name', regex: new RegExp(searchTerms.original, 'i') } },
                    1,
                    0
                  ]
                },
                this.weights.name
              ]
            },
            // Brand match
            {
              $multiply: [
                {
                  $cond: [
                    { $regexMatch: { input: '$basicInfo.brand', regex: new RegExp(searchTerms.original, 'i') } },
                    1,
                    0
                  ]
                },
                this.weights.brand
              ]
            },
            // Category match
            {
              $multiply: [
                {
                  $cond: [
                    { $in: ['$categoryInfo.name', searchTerms.categories] },
                    1,
                    0
                  ]
                },
                this.weights.category
              ]
            },
            // Tag matches
            {
              $multiply: [
                {
                  $size: {
                    $filter: {
                      input: '$tags',
                      as: 'tag',
                      cond: {
                        $in: [
                          { $toLower: '$$tag' },
                          searchTerms.words.map(w => w.toLowerCase())
                        ]
                      }
                    }
                  }
                },
                this.weights.tags
              ]
            },
            // Description match (partial)
            {
              $multiply: [
                {
                  $cond: [
                    { $regexMatch: { input: '$basicInfo.description', regex: new RegExp(searchTerms.original, 'i') } },
                    1,
                    0
                  ]
                },
                this.weights.description
              ]
            },
            // Popularity boost
            {
              $multiply: [
                { $ifNull: ['$views.count', 0] },
                this.weights.popularity
              ]
            },
            // Rating boost
            {
              $multiply: [
                { $ifNull: ['$ratings.average', 0] },
                this.weights.rating
              ]
            },
            // Availability boost
            {
              $multiply: [
                {
                  $cond: [
                    { $gt: ['$inventory.availableQuantity', 0] },
                    1,
                    0
                  ]
                },
                this.weights.availability
              ]
            }
          ]
        }
      }
    };
  }

  /**
   * Build filter stage
   */
  async buildFilterStage (filters) {
    const matchStage = { 'status.isActive': true };

    if (filters.category) {
      matchStage.category = mongoose.Types.ObjectId.isValid(filters.category) 
        ? mongoose.Types.ObjectId(filters.category)
        : { $in: await this.getCategoryIds(filters.category) };
    }

    if (filters.minPrice || filters.maxPrice) {
      matchStage['pricing.monthlyRent'] = {};
      if (filters.minPrice) matchStage['pricing.monthlyRent'].$gte = parseFloat(filters.minPrice);
      if (filters.maxPrice) matchStage['pricing.monthlyRent'].$lte = parseFloat(filters.maxPrice);
    }

    if (filters.condition) {
      const conditions = Array.isArray(filters.condition) 
        ? filters.condition 
        : [filters.condition];
      matchStage.condition = { $in: conditions };
    }

    if (filters.brand) {
      const brands = Array.isArray(filters.brand) ? filters.brand : [filters.brand];
      matchStage['basicInfo.brand'] = { $in: brands };
    }

    if (filters.inStock === 'true') {
      matchStage['inventory.availableQuantity'] = { $gt: 0 };
    }

    if (filters.rating) {
      matchStage['ratings.average'] = { $gte: parseFloat(filters.rating) };
    }

    if (filters.tags) {
      const tags = Array.isArray(filters.tags) ? filters.tags : filters.tags.split(',');
      matchStage.tags = { $in: tags };
    }

    if (filters.vendor) {
      matchStage.vendor = mongoose.Types.ObjectId(filters.vendor);
    }

    if (filters.city) {
      matchStage['vendorInfo.addresses.serviceableCities'] = filters.city;
    }

    return matchStage;
  }

  /**
   * Build sort stage
   */
  buildSortStage(sort, query) {
    switch (sort) {
      case 'price_asc':
        return { $sort: { 'pricing.monthlyRent': 1 } };
      case 'price_desc':
        return { $sort: { 'pricing.monthlyRent': -1 } };
      case 'rating_desc':
        return { $sort: { 'ratings.average': -1, 'ratings.count': -1 } };
      case 'newest':
        return { $sort: { createdAt: -1 } };
      case 'popularity':
        return { $sort: { 'views.count': -1, 'ratings.count': -1 } };
      case 'relevance':
      default:
        return query && query.trim() 
          ? { $sort: { searchScore: -1 } }
          : { $sort: { createdAt: -1 } };
    }
  }

  /**
   * Get search facets (filter options)
   */
  async getSearchFacets(query, currentFilters = {}) {
    try {
      const pipeline = [];

      // Apply same search criteria as main query
      if (query && query.trim()) {
        const searchTerms = this.processSearchQuery(query);
        pipeline.push(...this.buildTextSearchStage(searchTerms));
      }

      // Apply current filters except those we're faceting for
      const filterStage = this.buildFilterStage({
        ...currentFilters,
        category: undefined,
        brand: undefined,
        condition: undefined
      });

      if (Object.keys(filterStage).length > 0) {
        pipeline.push({ $match: filterStage });
      }

      // Add facets
      pipeline.push({
        $facet: {
          categories: [
            {
              $group: {
                _id: '$categoryInfo.name',
                count: { $sum: 1 }
              }
            },
            { $match: { _id: { $ne: null } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
          ],
          brands: [
            {
              $group: {
                _id: '$basicInfo.brand',
                count: { $sum: 1 }
              }
            },
            { $match: { _id: { $ne: null } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
          ],
          conditions: [
            {
              $group: {
                _id: '$condition',
                count: { $sum: 1 }
              }
            },
            { $match: { _id: { $ne: null } } }
          ],
          priceRanges: [
            {
              $bucket: {
                groupBy: '$pricing.monthlyRent',
                boundaries: [0, 1000, 2000, 3000, 5000, 10000, 20000],
                default: '20000+',
                output: {
                  count: { $sum: 1 }
                }
              }
            }
          ],
          ratings: [
            {
              $bucket: {
                groupBy: { $floor: '$ratings.average' },
                boundaries: [1, 2, 3, 4, 5],
                default: '0',
                output: {
                  count: { $sum: 1 }
                }
              }
            }
          ],
          tags: [
            { $unwind: '$tags' },
            {
              $group: {
                _id: '$tags',
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } },
            { $limit: 30 }
          ]
        }
      });

      const [facets] = await Product.aggregate(pipeline);

      return {
        categories: facets?.categories || [],
        brands: facets?.brands || [],
        conditions: facets?.conditions || [],
        priceRanges: facets?.priceRanges || [],
        ratings: facets?.ratings || [],
        tags: facets?.tags || []
      };
    } catch (error) {
      logger.error('Error in getSearchFacets:', error);
      return {};
    }
  }

  /**
   * Process search query with NLP
   */
  processSearchQuery(query) {
    const doc = compromise(query);
    
    // Extract categories
    const categories = doc.match('#Noun+').out('array');
    
    // Tokenize and stem
    const tokens = this.tokenizer.tokenize(query.toLowerCase());
    const stems = tokens.map(t => this.stemmer.stem(t));
    
    // Remove duplicates
    const uniqueWords = [...new Set(tokens)];
    const uniqueStems = [...new Set(stems)];

    return {
      original: query,
      words: uniqueWords,
      stems: uniqueStems,
      categories: categories.map(c => c.toLowerCase())
    };
  }

  /**
   * Get category IDs from slugs or names
   */
  async getCategoryIds(categoryInput) {
    const categories = await Category.find({
      $or: [
        { slug: categoryInput },
        { name: new RegExp(categoryInput, 'i') }
      ]
    }).distinct('_id');

    return categories;
  }

  /**
   * Generate search cache key
   */
  generateSearchCacheKey(type, query, filters, page, limit) {
    const filterString = JSON.stringify(filters);
    const hash = require('crypto')
      .createHash('md5')
      .update(`${query}-${filterString}-${page}-${limit}`)
      .digest('hex')
      .substring(0, 8);
    
    return `search:${type}:${hash}`;
  }

  /**
   * Autocomplete suggestions
   */
  async getSuggestions(query, limit = 10) {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      const cacheKey = `suggestions:${query}:${limit}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const regex = new RegExp(query, 'i');
      
      const [products, categories, brands] = await Promise.all([
        Product.find({
          $or: [
            { 'basicInfo.name': regex },
            { 'basicInfo.brand': regex },
            { tags: regex }
          ],
          'status.isActive': true
        })
        .limit(limit)
        .select('basicInfo.name basicInfo.brand category tags')
        .lean(),
        
        Category.find({ name: regex, isActive: true })
        .limit(5)
        .select('name slug')
        .lean(),
        
        Product.distinct('basicInfo.brand', {
          'basicInfo.brand': regex,
          'status.isActive': true
        }).then(brands => brands.slice(0, 5))
      ]);

      const suggestions = [];

      // Product suggestions
      products.forEach(p => {
        suggestions.push({
          type: 'product',
          text: p.basicInfo.name,
          category: 'Products',
          data: {
            id: p._id,
            slug: p.basicInfo.slug,
            brand: p.basicInfo.brand
          }
        });
      });

      // Category suggestions
      categories.forEach(c => {
        suggestions.push({
          type: 'category',
          text: c.name,
          category: 'Categories',
          data: {
            id: c._id,
            slug: c.slug
          }
        });
      });

      // Brand suggestions
      brands.forEach(b => {
        suggestions.push({
          type: 'brand',
          text: b,
          category: 'Brands',
          data: { brand: b }
        });
      });

      // Deduplicate and limit
      const uniqueSuggestions = suggestions
        .filter((s, index, self) => 
          index === self.findIndex(t => t.text === s.text)
        )
        .slice(0, limit);

      // Cache suggestions
      if (this.redisClient && uniqueSuggestions.length > 0) {
        await this.redisClient.setex(cacheKey, 600, JSON.stringify(uniqueSuggestions)); // 10 minutes
      }

      return uniqueSuggestions;
    } catch (error) {
      logger.error('Error in getSuggestions:', error);
      return [];
    }
  }

  /**
   * Fuzzy search with Fuse.js
   */
  async fuzzySearch(query, limit = 20) {
    try {
      const products = await Product.find({ 'status.isActive': true })
        .populate('category', 'name')
        .lean();

      const fuse = new Fuse(products, {
        ...this.fuseOptions,
        keys: [
          { name: 'basicInfo.name', weight: 3 },
          { name: 'basicInfo.description', weight: 1 },
          { name: 'basicInfo.brand', weight: 2 },
          { name: 'category.name', weight: 1.5 },
          { name: 'tags', weight: 2 }
        ]
      });

      const results = fuse.search(query).slice(0, limit);

      return results.map(r => ({
        item: {
          id: r.item._id,
          name: r.item.basicInfo.name,
          slug: r.item.basicInfo.slug,
          brand: r.item.basicInfo.brand,
          category: r.item.category?.name,
          image: r.item.media?.images?.[0]?.thumbnail
        },
        score: r.score,
        matches: r.matches
      }));
    } catch (error) {
      logger.error('Error in fuzzySearch:', error);
      return [];
    }
  }

  /**
   * Search vendors
   */
  async searchVendors(query, filters = {}, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const searchQuery = { 'status.isActive': true };

      if (query) {
        searchQuery.$or = [
          { 'business.name': new RegExp(query, 'i') },
          { 'business.description': new RegExp(query, 'i') },
          { 'vendorId': new RegExp(query, 'i') }
        ];
      }

      if (filters.city) {
        searchQuery['addresses.serviceableCities'] = filters.city;
      }

      if (filters.rating) {
        searchQuery['performance.rating.average'] = { $gte: parseFloat(filters.rating) };
      }

      if (filters.verified === 'true') {
        searchQuery['verification.status'] = 'verified';
      }

      const [vendors, total] = await Promise.all([
        Vendor.find(searchQuery)
          .populate('user', 'profile.firstName profile.lastName profile.avatar')
          .select('vendorId business.name business.description performance.rating verification.status addresses.serviceableCities')
          .sort({ 'performance.rating.average': -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Vendor.countDocuments(searchQuery)
      ]);

      return {
        vendors,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      logger.error('Error in searchVendors:', error);
      throw error;
    }
  }

  /**
   * Global search across multiple entities
   */
  async globalSearch(query, limit = 10) {
    try {
      const regex = new RegExp(query, 'i');

      const [products, vendors, categories] = await Promise.all([
        Product.find({
          $or: [
            { 'basicInfo.name': regex },
            { 'basicInfo.description': regex },
            { 'basicInfo.brand': regex }
          ],
          'status.isActive': true
        })
        .limit(limit)
        .select('basicInfo.name basicInfo.slug basicInfo.brand media.images pricing.monthlyRent')
        .lean(),

        Vendor.find({
          $or: [
            { 'business.name': regex },
            { 'business.description': regex }
          ],
          'status.isActive': true
        })
        .limit(limit)
        .populate('user', 'profile.firstName profile.lastName')
        .select('vendorId business.name business.description performance.rating')
        .lean(),

        Category.find({ name: regex, isActive: true })
        .limit(limit)
        .select('name slug image productCount')
        .lean()
      ]);

      return {
        products: products.map(p => ({
          type: 'product',
          id: p._id,
          name: p.basicInfo.name,
          slug: p.basicInfo.slug,
          brand: p.basicInfo.brand,
          image: p.media?.images?.[0]?.thumbnail,
          price: p.pricing?.monthlyRent
        })),
        vendors: vendors.map(v => ({
          type: 'vendor',
          id: v._id,
          vendorId: v.vendorId,
          name: v.business.name,
          description: v.business.description,
          rating: v.performance?.rating?.average,
          owner: v.user ? `${v.user.profile.firstName} ${v.user.profile.lastName}` : null
        })),
        categories: categories.map(c => ({
          type: 'category',
          id: c._id,
          name: c.name,
          slug: c.slug,
          image: c.image?.thumbnail,
          productCount: c.productCount
        }))
      };
    } catch (error) {
      logger.error('Error in globalSearch:', error);
      throw error;
    }
  }

  /**
   * Trending searches
   */
  async getTrendingSearches(limit = 10) {
    try {
      // This would typically come from a search analytics collection
      // For now, return popular categories and products
      const [popularCategories, popularProducts] = await Promise.all([
        Category.find({ isActive: true })
          .sort({ productCount: -1 })
          .limit(limit)
          .select('name')
          .lean(),
        Product.find({ 'status.isActive': true })
          .sort({ 'views.count': -1 })
          .limit(limit)
          .select('basicInfo.name')
          .lean()
      ]);

      const trending = [
        ...popularCategories.map(c => ({ text: c.name, type: 'category', score: c.productCount })),
        ...popularProducts.map(p => ({ text: p.basicInfo.name, type: 'product', score: p.views?.count || 0 }))
      ];

      return trending
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(t => ({ text: t.text, type: t.type }));
    } catch (error) {
      logger.error('Error in getTrendingSearches:', error);
      return [];
    }
  }

  /**
   * Get search history for user
   */
  async getUserSearchHistory(userId, limit = 20) {
    try {
      // This would require a SearchHistory model
      // Placeholder implementation
      return [];
    } catch (error) {
      logger.error('Error in getUserSearchHistory:', error);
      return [];
    }
  }

  /**
   * Save search query to history
   */
  async saveSearchQuery(userId, query, results = 0) {
    try {
      // This would save to a SearchHistory collection
      // Placeholder
      return true;
    } catch (error) {
      logger.error('Error in saveSearchQuery:', error);
      return false;
    }
  }

  /**
   * Get popular search terms
   */
  async getPopularSearches(limit = 10) {
    try {
      // This would come from search analytics
      // Placeholder
      return [
        'sofa',
        'refrigerator',
        'washing machine',
        'bed',
        'dining table',
        'ac',
        'tv',
        'office chair',
        'wardrobe',
        'microwave'
      ].slice(0, limit);
    } catch (error) {
      logger.error('Error in getPopularSearches:', error);
      return [];
    }
  }
}

module.exports = new SearchService();