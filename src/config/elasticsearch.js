const { Client } = require('@elastic/elasticsearch');
const logger = require('./logger');
const constants = require('./constants');

let esClient = null;

// Elasticsearch configuration
const elasticsearchConfig = {
  node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD,
  },
  maxRetries: 5,
  requestTimeout: 60000,
  sniffOnStart: false,
  sniffOnConnectionFault: false,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : null,
};

// Initialize Elasticsearch client
const initElasticsearch = async () => {
  try {
    esClient = new Client(elasticsearchConfig);

    // Test connection
    const health = await esClient.cluster.health();
    logger.info(`Elasticsearch connected successfully. Cluster status: ${health.status}`);

    // Create indices if they don't exist
    await createIndices();

    return esClient;
  } catch (error) {
    logger.error('Elasticsearch connection failed:', error);
    // Don't throw error, app can work without Elasticsearch (fallback to MongoDB search)
    return null;
  }
};

// Create indices
const createIndices = async () => {
  if (!esClient) return;

  const indices = [
    {
      name: 'products',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          name: { 
            type: 'text',
            fields: {
              keyword: { type: 'keyword' },
              suggest: { type: 'completion' }
            }
          },
          description: { type: 'text' },
          category: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' },
              slug: { type: 'keyword' }
            }
          },
          vendor: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' },
              rating: { type: 'float' }
            }
          },
          pricing: {
            properties: {
              monthlyRent: { type: 'float' },
              securityDeposit: { type: 'float' },
              deliveryCharges: { type: 'float' }
            }
          },
          specifications: { type: 'object', enabled: false },
          condition: { type: 'keyword' },
          brand: { type: 'text' },
          tags: { type: 'keyword' },
          features: { type: 'text' },
          location: {
            properties: {
              city: { type: 'keyword' },
              pincode: { type: 'keyword' },
              coordinates: { type: 'geo_point' }
            }
          },
          availability: {
            properties: {
              available: { type: 'boolean' },
              quantity: { type: 'integer' }
            }
          },
          ratings: {
            properties: {
              average: { type: 'float' },
              count: { type: 'integer' }
            }
          },
          createdAt: { type: 'date' },
          updatedAt: { type: 'date' }
        }
      },
      settings: {
        analysis: {
          analyzer: {
            custom_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'stop', 'snowball']
            }
          }
        }
      }
    },
    {
      name: 'vendors',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          businessName: { 
            type: 'text',
            fields: {
              keyword: { type: 'keyword' }
            }
          },
          description: { type: 'text' },
          categories: { type: 'keyword' },
          location: {
            properties: {
              city: { type: 'keyword' },
              pincode: { type: 'keyword' },
              coordinates: { type: 'geo_point' }
            }
          },
          rating: { type: 'float' },
          totalRentals: { type: 'integer' },
          verificationStatus: { type: 'keyword' },
          createdAt: { type: 'date' }
        }
      }
    },
    {
      name: 'users',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          email: { type: 'keyword' },
          phone: { type: 'keyword' },
          firstName: { type: 'text' },
          lastName: { type: 'text' },
          role: { type: 'keyword' },
          status: { type: 'keyword' },
          createdAt: { type: 'date' }
        }
      }
    },
    {
      name: 'rentals',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          rentalNumber: { type: 'keyword' },
          user: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' }
            }
          },
          vendor: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' }
            }
          },
          product: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' }
            }
          },
          status: { type: 'keyword' },
          startDate: { type: 'date' },
          endDate: { type: 'date' },
          totalAmount: { type: 'float' },
          createdAt: { type: 'date' }
        }
      }
    }
  ];

  for (const index of indices) {
    try {
      const exists = await esClient.indices.exists({ index: index.name });
      if (!exists) {
        await esClient.indices.create({
          index: index.name,
          body: {
            mappings: index.mappings,
            settings: index.settings
          }
        });
        logger.info(`Created Elasticsearch index: ${index.name}`);
      }
    } catch (error) {
      logger.error(`Error creating index ${index.name}:`, error);
    }
  }
};

// Get Elasticsearch client
const getEsClient = () => esClient;

// Index a document
const indexDocument = async (index, id, document) => {
  if (!esClient) return null;
  
  try {
    const result = await esClient.index({
      index,
      id,
      body: document,
      refresh: false
    });
    return result;
  } catch (error) {
    logger.error(`Error indexing document in ${index}:`, error);
    return null;
  }
};

// Update a document
const updateDocument = async (index, id, document) => {
  if (!esClient) return null;
  
  try {
    const result = await esClient.update({
      index,
      id,
      body: { doc: document },
      retry_on_conflict: 3
    });
    return result;
  } catch (error) {
    logger.error(`Error updating document in ${index}:`, error);
    return null;
  }
};

// Delete a document
const deleteDocument = async (index, id) => {
  if (!esClient) return null;
  
  try {
    const result = await esClient.delete({
      index,
      id
    });
    return result;
  } catch (error) {
    logger.error(`Error deleting document from ${index}:`, error);
    return null;
  }
};

// Bulk index documents
const bulkIndex = async (operations) => {
  if (!esClient) return null;
  
  try {
    const result = await esClient.bulk({
      body: operations,
      refresh: false
    });
    
    if (result.errors) {
      logger.error('Bulk indexing had errors:', result.items.filter(i => i.error));
    }
    
    return result;
  } catch (error) {
    logger.error('Error in bulk indexing:', error);
    return null;
  }
};

// Search products
const searchProducts = async (query, filters = {}, pagination = {}) => {
  if (!esClient) return null;

  const { page = 1, limit = 10 } = pagination;
  const from = (page - 1) * limit;

  // Build search query
  const searchBody = {
    from,
    size: limit,
    query: {
      bool: {
        must: [],
        filter: [],
        should: []
      }
    },
    sort: [],
    aggs: {
      categories: { terms: { field: 'category.id', size: 10 } },
      brands: { terms: { field: 'brand.keyword', size: 10 } },
      conditions: { terms: { field: 'condition', size: 10 } },
      price_ranges: {
        range: {
          field: 'pricing.monthlyRent',
          ranges: [
            { to: 1000, key: 'under_1000' },
            { from: 1000, to: 3000, key: '1000_3000' },
            { from: 3000, to: 5000, key: '3000_5000' },
            { from: 5000, key: 'above_5000' }
          ]
        }
      },
      cities: { terms: { field: 'location.city', size: 10 } },
      min_price: { min: { field: 'pricing.monthlyRent' } },
      max_price: { max: { field: 'pricing.monthlyRent' } }
    }
  };

  // Text search
  if (query) {
    searchBody.query.bool.must.push({
      multi_match: {
        query,
        fields: ['name^3', 'description', 'brand^2', 'category.name^2', 'tags'],
        fuzziness: 'AUTO',
        operator: 'and',
        minimum_should_match: '75%'
      }
    });
  } else {
    searchBody.query.bool.must.push({ match_all: {} });
  }

  // Filters
  if (filters.category) {
    searchBody.query.bool.filter.push({ term: { 'category.id': filters.category } });
  }

  if (filters.brand) {
    searchBody.query.bool.filter.push({ term: { 'brand.keyword': filters.brand } });
  }

  if (filters.condition) {
    const conditions = Array.isArray(filters.condition) ? filters.condition : [filters.condition];
    searchBody.query.bool.filter.push({ terms: { condition: conditions } });
  }

  if (filters.minPrice || filters.maxPrice) {
    const range = {};
    if (filters.minPrice) range.gte = filters.minPrice;
    if (filters.maxPrice) range.lte = filters.maxPrice;
    searchBody.query.bool.filter.push({ range: { 'pricing.monthlyRent': range } });
  }

  if (filters.city) {
    searchBody.query.bool.filter.push({ term: { 'location.city': filters.city } });
  }

  if (filters.pincode) {
    searchBody.query.bool.filter.push({ term: { 'location.pincode': filters.pincode } });
  }

  if (filters.available === true) {
    searchBody.query.bool.filter.push({ term: { 'availability.available': true } });
  }

  if (filters.minRating) {
    searchBody.query.bool.filter.push({ range: { 'ratings.average': { gte: filters.minRating } } });
  }

  if (filters.tags) {
    const tags = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
    searchBody.query.bool.filter.push({ terms: { tags } });
  }

  if (filters.vendor) {
    searchBody.query.bool.filter.push({ term: { 'vendor.id': filters.vendor } });
  }

  // Sorting
  if (filters.sort) {
    switch (filters.sort) {
      case constants.SORT_OPTIONS.PRICE_ASC:
        searchBody.sort.push({ 'pricing.monthlyRent': { order: 'asc' } });
        break;
      case constants.SORT_OPTIONS.PRICE_DESC:
        searchBody.sort.push({ 'pricing.monthlyRent': { order: 'desc' } });
        break;
      case constants.SORT_OPTIONS.NEWEST:
        searchBody.sort.push({ createdAt: { order: 'desc' } });
        break;
      case constants.SORT_OPTIONS.RATING:
        searchBody.sort.push({ 'ratings.average': { order: 'desc' } });
        break;
      case constants.SORT_OPTIONS.POPULARITY:
        searchBody.sort.push({ 'ratings.count': { order: 'desc' } });
        break;
      default:
        searchBody.sort.push({ _score: { order: 'desc' } });
    }
  } else {
    searchBody.sort.push({ _score: { order: 'desc' } });
  }

  try {
    const result = await esClient.search({
      index: 'products',
      body: searchBody
    });

    return {
      total: result.hits.total.value,
      page,
      limit,
      totalPages: Math.ceil(result.hits.total.value / limit),
      hits: result.hits.hits.map(h => ({
        id: h._id,
        score: h._score,
        ...h._source
      })),
      aggregations: result.aggregations
    };
  } catch (error) {
    logger.error('Error searching products:', error);
    return null;
  }
};

// Get suggestions
const getSuggestions = async (query, size = 5) => {
  if (!esClient) return [];

  try {
    const result = await esClient.search({
      index: 'products',
      body: {
        size: 0,
        suggest: {
          product_suggest: {
            prefix: query,
            completion: {
              field: 'name.suggest',
              size,
              fuzzy: {
                fuzziness: 'AUTO'
              }
            }
          }
        }
      }
    });

    const suggestions = result.suggest.product_suggest[0].options.map(option => ({
      text: option.text,
      score: option._score,
      productId: option._id
    }));

    return suggestions;
  } catch (error) {
    logger.error('Error getting suggestions:', error);
    return [];
  }
};

// Get similar products
const getSimilarProducts = async (productId, size = 5) => {
  if (!esClient) return [];

  try {
    // Get the product first
    const product = await esClient.get({
      index: 'products',
      id: productId
    });

    const result = await esClient.search({
      index: 'products',
      body: {
        size,
        query: {
          more_like_this: {
            fields: ['name', 'description', 'category.name', 'tags'],
            like: [
              {
                _index: 'products',
                _id: productId
              }
            ],
            min_term_freq: 1,
            max_query_terms: 12,
            minimum_should_match: '30%'
          }
        }
      }
    });

    return result.hits.hits.map(h => ({
      id: h._id,
      score: h._score,
      ...h._source
    }));
  } catch (error) {
    logger.error('Error getting similar products:', error);
    return [];
  }
};

// Get vendor analytics
const getVendorAnalytics = async (vendorId, dateRange) => {
  if (!esClient) return null;

  const { startDate, endDate } = dateRange;

  try {
    const result = await esClient.search({
      index: 'rentals',
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              { term: { 'vendor.id': vendorId } },
              { range: { createdAt: { gte: startDate, lte: endDate } } }
            ]
          }
        },
        aggs: {
          total_rentals: { value_count: { field: 'id' } },
          total_revenue: { sum: { field: 'totalAmount' } },
          avg_rental_value: { avg: { field: 'totalAmount' } },
          by_status: {
            terms: { field: 'status', size: 10 }
          },
          by_month: {
            date_histogram: {
              field: 'createdAt',
              calendar_interval: 'month',
              format: 'yyyy-MM'
            },
            aggs: {
              revenue: { sum: { field: 'totalAmount' } },
              count: { value_count: { field: 'id' } }
            }
          },
          popular_products: {
            terms: { field: 'product.id', size: 5 },
            aggs: {
              product_name: { terms: { field: 'product.name', size: 1 } },
              revenue: { sum: { field: 'totalAmount' } }
            }
          }
        }
      }
    });

    return result.aggregations;
  } catch (error) {
    logger.error('Error getting vendor analytics:', error);
    return null;
  }
};

// Reindex data from MongoDB to Elasticsearch
const reindexFromMongoDB = async (Model, indexName, transformFunction) => {
  if (!esClient) return;

  try {
    const cursor = Model.find().cursor();
    let bulkOps = [];
    let count = 0;

    for await (const doc of cursor) {
      const transformed = transformFunction(doc);
      
      bulkOps.push(
        { index: { _index: indexName, _id: doc._id.toString() } },
        transformed
      );

      count++;

      // Bulk in batches of 500
      if (bulkOps.length >= 1000) {
        await bulkIndex(bulkOps);
        bulkOps = [];
        logger.info(`Indexed ${count} documents to ${indexName}`);
      }
    }

    // Index remaining
    if (bulkOps.length > 0) {
      await bulkIndex(bulkOps);
      logger.info(`Indexed ${count} documents to ${indexName}`);
    }

    logger.info(`Completed reindexing ${indexName} with ${count} documents`);
  } catch (error) {
    logger.error(`Error reindexing ${indexName}:`, error);
  }
};

// Delete index
const deleteIndex = async (indexName) => {
  if (!esClient) return;

  try {
    await esClient.indices.delete({ index: indexName });
    logger.info(`Deleted index: ${indexName}`);
  } catch (error) {
    logger.error(`Error deleting index ${indexName}:`, error);
  }
};

module.exports = {
  initElasticsearch,
  getEsClient,
  indexDocument,
  updateDocument,
  deleteDocument,
  bulkIndex,
  searchProducts,
  getSuggestions,
  getSimilarProducts,
  getVendorAnalytics,
  reindexFromMongoDB,
  deleteIndex
};