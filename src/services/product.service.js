const { Product, Category, Vendor, Inventory, Review, Rental } = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const slugify = require('slugify');
const natural = require('natural');
const compromise = require('compromise');
const Sentiment = require('sentiment');
const { OpenAI } = require('openai');

class ProductService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
    this.sentiment = new Sentiment();
    this.openai = null;
    
    // Initialize OpenAI if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
  }

  /**
   * Generate unique slug
   */
  async generateSlug(name, vendorId) {
    let slug = slugify(name, { lower: true, strict: true });
    
    // Check if slug exists for this vendor
    const existingProduct = await Product.findOne({ 
      'basicInfo.slug': slug,
      vendor: vendorId
    });
    
    if (!existingProduct) {
      return slug;
    }
    
    // If slug exists, append number
    let counter = 1;
    let newSlug = `${slug}-${counter}`;
    while (await Product.findOne({ 
      'basicInfo.slug': newSlug,
      vendor: vendorId 
    })) {
      counter++;
      newSlug = `${slug}-${counter}`;
    }
    
    return newSlug;
  }

  /**
   * Generate SKU
   */
  async generateSKU(vendorId, categoryId) {
    const vendor = await Vendor.findOne({ user: vendorId }).select('vendorId');
    const category = await Category.findById(categoryId).select('slug');
    
    const vendorPrefix = vendor?.vendorId?.slice(-4) || 'XXXX';
    const categoryPrefix = category?.slug?.slice(0, 3).toUpperCase() || 'GEN';
    
    const count = await Product.countDocuments({ vendor: vendorId }) + 1;
    const sequential = String(count).padStart(4, '0');
    
    return `${categoryPrefix}${vendorPrefix}${sequential}`;
  }

  /**
   * AI-powered product description generation
   */
  async generateAIDescription(productData) {
    if (!this.openai) {
      return null;
    }

    try {
      const { name, category, brand, specifications } = productData;
      
      const prompt = `Generate a compelling product description for a rental item with the following details:
        Name: ${name}
        Category: ${category}
        Brand: ${brand || 'Unknown'}
        Specifications: ${JSON.stringify(specifications || {})}
        
        The description should be:
        - Professional and appealing for a rental platform
        - Highlight key features and benefits
        - Include condition expectations
        - Mention ideal use cases
        - Be between 150-200 words
        - Include rental-specific information`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a professional product description writer for a furniture and appliance rental platform." },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.error('AI description generation error:', error);
      return null;
    }
  }

  /**
   * Extract keywords from product data
   */
  extractKeywords(product) {
    try {
      const text = [
        product.basicInfo.name,
        product.basicInfo.description,
        product.basicInfo.brand,
        product.category?.name,
        ...(product.tags || [])
      ].filter(Boolean).join(' ');

      // Use compromise for NLP
      const doc = compromise(text);
      
      // Extract nouns and adjectives
      const nouns = doc.nouns().out('array');
      const adjectives = doc.adjectives().out('array');
      
      // Combine and deduplicate
      const keywords = [...new Set([...nouns, ...adjectives])]
        .filter(k => k.length > 2)
        .slice(0, 20);

      return keywords;
    } catch (error) {
      logger.error('Keyword extraction error:', error);
      return [];
    }
  }

  /**
   * Analyze product sentiment from reviews
   */
  async analyzeProductSentiment(productId) {
    try {
      const reviews = await Review.find({ 
        product: productId,
        'moderation.status': 'approved'
      }).select('content ratings.overall');

      if (reviews.length === 0) {
        return {
          overall: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          commonPhrases: []
        };
      }

      // Calculate sentiment scores
      let totalScore = 0;
      let positive = 0, neutral = 0, negative = 0;
      const phrases = [];

      reviews.forEach(review => {
        const score = this.sentiment.analyze(review.content);
        totalScore += score.score;
        
        if (score.score > 0) positive++;
        else if (score.score < 0) negative++;
        else neutral++;

        // Extract key phrases
        const doc = compromise(review.content);
        const nouns = doc.nouns().out('array');
        const adjectives = doc.adjectives().out('array');
        phrases.push(...nouns, ...adjectives);
      });

      // Get most common phrases
      const phraseCounts = {};
      phrases.forEach(p => {
        if (p.length > 3) {
          phraseCounts[p] = (phraseCounts[p] || 0) + 1;
        }
      });

      const commonPhrases = Object.entries(phraseCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([phrase, count]) => ({ phrase, count }));

      return {
        overall: totalScore / reviews.length,
        distribution: { positive, neutral, negative },
        commonPhrases
      };
    } catch (error) {
      logger.error('Sentiment analysis error:', error);
      return null;
    }
  }

  /**
   * Get AI-powered product recommendations
   */
  async getAIRecommendations(userId, limit = 10) {
    try {
      if (!this.openai) {
        return this.getCollaborativeRecommendations(userId, limit);
      }

      // Get user's rental history
      const userRentals = await Rental.find({ 
        user: userId,
        status: { $in: ['completed', 'active'] }
      })
      .populate('product')
      .limit(20)
      .lean();

      if (userRentals.length === 0) {
        return this.getPopularProducts(limit);
      }

      // Extract user preferences
      const preferences = userRentals.map(r => ({
        category: r.product?.category,
        brand: r.product?.basicInfo?.brand,
        price: r.product?.pricing?.monthlyRent,
        condition: r.product?.condition
      }));

      // Use AI to generate recommendation criteria
      const prompt = `Based on a user's rental history, generate search criteria for product recommendations:
        History: ${JSON.stringify(preferences)}
        
        Return a JSON object with:
        - categories: array of category IDs to prioritize
        - priceRange: { min, max }
        - brands: array of preferred brands
        - conditions: array of acceptable conditions
        - keywords: array of search terms`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a recommendation engine for a rental platform." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      });

      const criteria = JSON.parse(response.choices[0].message.content);

      // Build query based on AI criteria
      const query = { 'status.isActive': true };
      
      if (criteria.categories?.length) {
        query.category = { $in: criteria.categories };
      }
      
      if (criteria.priceRange) {
        query['pricing.monthlyRent'] = {
          $gte: criteria.priceRange.min || 0,
          $lte: criteria.priceRange.max || 100000
        };
      }
      
      if (criteria.brands?.length) {
        query['basicInfo.brand'] = { $in: criteria.brands };
      }
      
      if (criteria.conditions?.length) {
        query.condition = { $in: criteria.conditions };
      }

      if (criteria.keywords?.length) {
        query.$text = { $search: criteria.keywords.join(' ') };
      }

      const recommendations = await Product.find(query)
        .populate('vendor', 'business.name')
        .populate('category', 'name')
        .sort({ 'ratings.average': -1, createdAt: -1 })
        .limit(limit)
        .lean();

      return recommendations;
    } catch (error) {
      logger.error('AI recommendations error:', error);
      return this.getCollaborativeRecommendations(userId, limit);
    }
  }

  /**
   * Collaborative filtering recommendations
   */
  async getCollaborativeRecommendations(userId, limit = 10) {
    try {
      // Find users with similar rental patterns
      const userRentals = await Rental.find({ user: userId }).distinct('product');
      
      const similarUsers = await Rental.aggregate([
        { $match: { product: { $in: userRentals }, user: { $ne: userId } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
      ]);

      const similarUserIds = similarUsers.map(u => u._id);

      // Get products rented by similar users but not by current user
      const recommendations = await Rental.aggregate([
        { $match: { 
          user: { $in: similarUserIds },
          product: { $nin: userRentals }
        }},
        { $group: { 
          _id: '$product', 
          score: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }},
        { $sort: { score: -1, avgRating: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $project: {
            _id: '$product._id',
            basicInfo: '$product.basicInfo',
            pricing: '$product.pricing',
            media: '$product.media',
            category: '$product.category',
            vendor: '$product.vendor',
            ratings: '$product.ratings',
            recommendationScore: '$score'
          }
        }
      ]);

      return recommendations;
    } catch (error) {
      logger.error('Collaborative recommendations error:', error);
      return [];
    }
  }

  /**
   * Get popular products
   */
  async getPopularProducts(limit = 10) {
    try {
      const products = await Rental.aggregate([
        { $group: { 
          _id: '$product', 
          rentalCount: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }},
        { $sort: { rentalCount: -1, avgRating: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $match: {
            'product.status.isActive': true
          }
        },
        {
          $project: {
            _id: '$product._id',
            basicInfo: '$product.basicInfo',
            pricing: '$product.pricing',
            media: '$product.media',
            category: '$product.category',
            vendor: '$product.vendor',
            ratings: '$product.ratings',
            popularityScore: '$rentalCount'
          }
        }
      ]);

      return products;
    } catch (error) {
      logger.error('Popular products error:', error);
      return [];
    }
  }

  /**
   * Get trending products (most rented in last 30 days)
   */
  async getTrendingProducts(limit = 10) {
    try {
      const cacheKey = `products:trending:${limit}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Calculate date for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const trendingProducts = await Rental.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
            status: { $in: ['completed', 'active'] }
          }
        },
        {
          $group: {
            _id: '$product',
            rentalCount: { $sum: 1 },
            totalRevenue: { $sum: '$rentalDetails.totalAmount' }
          }
        },
        { $sort: { rentalCount: -1, totalRevenue: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $match: {
            'product.status.isActive': true,
            'product.inventory.availableQuantity': { $gt: 0 }
          }
        },
        {
          $project: {
            _id: '$product._id',
            basicInfo: '$product.basicInfo',
            pricing: '$product.pricing',
            media: '$product.media',
            category: '$product.category',
            vendor: '$product.vendor',
            ratings: '$product.ratings',
            condition: '$product.condition',
            rentalCount: 1,
            totalRevenue: 1
          }
        }
      ]);

      // Cache for 1 hour
      if (this.redisClient && trendingProducts.length > 0) {
        await this.redisClient.setex(cacheKey, 3600, JSON.stringify(trendingProducts));
      }

      return trendingProducts;
    } catch (error) {
      logger.error('Error in getTrendingProducts:', error);
      return [];
    }
  }

  /**
   * Get new arrivals (recently added products)
   */
  async getNewArrivals(limit = 10, days = 30) {
    try {
      const cacheKey = `products:new-arrivals:${limit}:${days}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Calculate date for last X days
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - days);

      const newArrivals = await Product.find({
        'status.isActive': true,
        'status.approvalStatus': 'approved',
        'inventory.availableQuantity': { $gt: 0 },
        createdAt: { $gte: daysAgo }
      })
      .populate('vendor', 'business.name')
      .populate('category', 'name slug')
      .select('basicInfo.name basicInfo.slug basicInfo.brand pricing monthlyRent media.images condition ratings.average vendor category createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

      // Cache for 30 minutes
      if (this.redisClient && newArrivals.length > 0) {
        await this.redisClient.setex(cacheKey, 1800, JSON.stringify(newArrivals));
      }

      return newArrivals;
    } catch (error) {
      logger.error('Error in getNewArrivals:', error);
      return [];
    }
  }

  /**
   * Get most popular products (all-time)
   */
  async getMostPopularProducts(limit = 10) {
    try {
      const cacheKey = `products:most-popular:${limit}`;
      
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const popularProducts = await Rental.aggregate([
        {
          $group: {
            _id: '$product',
            totalRentals: { $sum: 1 },
            totalRevenue: { $sum: '$rentalDetails.totalAmount' }
          }
        },
        { $sort: { totalRentals: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $match: {
            'product.status.isActive': true,
            'product.inventory.availableQuantity': { $gt: 0 }
          }
        },
        {
          $project: {
            _id: '$product._id',
            basicInfo: '$product.basicInfo',
            pricing: '$product.pricing',
            media: '$product.media',
            category: '$product.category',
            vendor: '$product.vendor',
            ratings: '$product.ratings',
            condition: '$product.condition',
            totalRentals: 1,
            totalRevenue: 1
          }
        }
      ]);

      if (this.redisClient && popularProducts.length > 0) {
        await this.redisClient.setex(cacheKey, 3600, JSON.stringify(popularProducts));
      }

      return popularProducts;
    } catch (error) {
      logger.error('Error in getMostPopularProducts:', error);
      return [];
    }
  }

  /**
   * Create new product
   */
  async createProduct(vendorId, productData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { 
        basicInfo, 
        category, 
        pricing, 
        inventory, 
        condition,
        specifications,
        media,
        rentalTerms,
        tags,
        features,
        generateDescription = false
      } = productData;

      // Verify vendor
      const vendor = await Vendor.findOne({ user: vendorId });
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // Check vendor's subscription limits
      if (vendor.subscription?.limits?.maxProducts > 0) {
        const productCount = await Product.countDocuments({ vendor: vendorId });
        if (productCount >= vendor.subscription.limits.maxProducts) {
          throw new AppError('Vendor has reached maximum product limit', 400);
        }
      }

      // Verify category
      const categoryDoc = await Category.findById(category);
      if (!categoryDoc) {
        throw new AppError('Category not found', 404);
      }

      // Generate slug
      const slug = await this.generateSlug(basicInfo.name, vendor._id);

      // Generate SKU
      const sku = await this.generateSKU(vendorId, category);

      // Generate AI description if requested
      let description = basicInfo.description;
      if (generateDescription && !description) {
        const aiDescription = await this.generateAIDescription({
          name: basicInfo.name,
          category: categoryDoc.name,
          brand: basicInfo.brand,
          specifications
        });
        if (aiDescription) {
          description = aiDescription;
        }
      }

      // Extract keywords for search
      const extractedKeywords = this.extractKeywords({
        basicInfo: { ...basicInfo, description },
        category: categoryDoc,
        tags
      });

      // Create product
      const product = await Product.create([{
        // vendor: vendorId,
         vendor: vendor._id,
        category,
        basicInfo: {
          ...basicInfo,
          description,
          slug,
          sku
        },
        pricing,
        inventory: {
          totalQuantity: inventory.totalQuantity,
          availableQuantity: inventory.totalQuantity
        },
        specifications,
        condition,
        media,
        rentalTerms,
        tags: [...new Set([...(tags || []), ...extractedKeywords])],
        features,
        metadata: {
          createdBy: vendorId
        }
      }], { session });

      // Create inventory items
      const inventoryItems = [];
      for (let i = 0; i < inventory.totalQuantity; i++) {
        inventoryItems.push({
          product: product[0]._id,
          sku: `${sku}-${String(i + 1).padStart(3, '0')}`,
          status: 'available',
          condition: {
            status: condition
          }
        });
      }

      if (inventoryItems.length > 0) {
        await Inventory.insertMany(inventoryItems, { session });
      }

      await session.commitTransaction();

      // Update category product count
      await this.updateCategoryProductCount(category);

      // Emit event
      eventEmitter.emit(EVENTS.PRODUCT.CREATED, {
        productId: product[0]._id,
        vendorId,
        productName: product[0].basicInfo.name,
        categoryId: category
      });

      return product[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createProduct:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get product by ID or slug
   */
  async getProduct(identifier, userId = null) {
    try {
      const cacheKey = `product:${identifier}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Check if identifier is MongoDB ObjectId or slug
      const isObjectId = mongoose.Types.ObjectId.isValid(identifier);
      
      const query = isObjectId 
        ? { _id: identifier }
        : { 'basicInfo.slug': identifier };

      console.log("Querying product with:", query);  
      
      const product = await Product.findOne(query)
        .populate('vendor', 'business.name business.description user performance.rating')
        .populate('category', 'name slug')
        .populate({
          path: 'reviews',
          match: { 'moderation.status': 'approved' },
          options: { sort: { createdAt: -1 }, limit: 10 },
          populate: {
            path: 'user',
            select: 'profile.firstName profile.lastName profile.avatar'
          }
        })
        .lean();

      if (!product) {
        throw new AppError('Product not foundsss', 404);
      }

      // Increment view count
      await Product.findByIdAndUpdate(product._id, {
        $inc: { 'views.count': 1 }
      });

      // Get similar products
      const similarProducts = await this.getSimilarProducts(product._id, 5);

      // Get availability
      const availability = await this.checkAvailability(product._id);

      // Get rental stats
      const rentalStats = await this.getProductRentalStats(product._id);

      // Analyze sentiment if there are reviews
      let sentiment = null;
      if (product.reviews?.length > 0) {
        sentiment = await this.analyzeProductSentiment(product._id);
      }

      const result = {
        ...product,
        availability,
        rentalStats,
        similarProducts,
        sentiment
      };

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, this.defaultTTL, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      logger.error('Error in getProduct:', error);
      throw error;
    }
  }

  /**
   * Update product
   */
  async updateProduct(productId, vendorId, updateData) {
    const session = await mongoose.startSession();
    session.startTransaction();


    // console.log("req.admin._id:", req.admin);

    const query = { _id: productId };
    if (vendorId) query.vendor = vendorId;

    try {
      const product = await Product.findOne(query).session(session);
      console.log("Found product:", product)

      if (!product) {
        throw new AppError('Product not found or unauthorized', 404);
      }

      // If name is being updated, regenerate slug
      if (updateData.basicInfo?.name && 
          updateData.basicInfo.name !== product.basicInfo.name) {
        updateData.basicInfo.slug = await this.generateSlug(
          updateData.basicInfo.name, 
          vendorId
        );
      }

      // If inventory quantity is being updated, create/destroy inventory items
      if (updateData.inventory?.totalQuantity) {
        const currentQuantity = product.inventory.totalQuantity;
        const newQuantity = updateData.inventory.totalQuantity;
        
        if (newQuantity > currentQuantity) {
          // Add new inventory items
          const sku = product.basicInfo.sku;
          const newItems = [];
          for (let i = currentQuantity; i < newQuantity; i++) {
            newItems.push({
              product: productId,
              sku: `${sku}-${String(i + 1).padStart(3, '0')}`,
              status: 'available',
              condition: {
                status: product.condition
              }
            });
          }
          await Inventory.insertMany(newItems, { session });
        } else if (newQuantity < currentQuantity) {
          // Remove excess inventory items (only if not rented)
          const itemsToRemove = currentQuantity - newQuantity;
          const availableItems = await Inventory.find({
            product: productId,
            status: 'available'
          }).limit(itemsToRemove).session(session);
          
          if (availableItems.length < itemsToRemove) {
            throw new AppError(
              'Cannot reduce quantity: Some items are currently rented', 
              400
            );
          }
          
          const itemIds = availableItems.map(i => i._id);
          await Inventory.deleteMany({ _id: { $in: itemIds } }, { session });
        }
      }

      // Update fields
      Object.assign(product, updateData);
      product.metadata.updatedBy = vendorId;
      product.metadata.updatedAt = new Date();
      
      await product.save({ session });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateProductCache(productId);

      // Emit event
      eventEmitter.emit(EVENTS.PRODUCT.UPDATED, {
        productId: product._id,
        vendorId,
        productName: product.basicInfo.name,
        changes: Object.keys(updateData)
      });

      return product;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateProduct:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
 * Invalidate product list cache
 */
async invalidateProductListCache() {
  try {
    if (this.redisClient) {
      const patterns = [
        'products:search:*',
        'products:featured:*',
        'products:trending:*',
        'products:new-arrivals:*',
        'products:most-popular:*'
      ];
      
      for (const pattern of patterns) {
        const keys = await this.redisClient.keys(pattern);
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      }
    }
  } catch (error) {
    logger.error('Error invalidating product list cache:', error);
  }
}

  /**
   * Approve product (admin only)
   */
  async approveProduct(productId, adminId, notes = '') {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(productId).session(session);
      
      if (!product) {
        throw new AppError('Product not found', 404);
      }

      // Update product status
      product.status.isVerified = true;
      product.status.approvalStatus = 'approved';
      product.status.approvedAt = new Date();
      product.status.approvedBy = adminId;
      product.status.approvalNotes = notes;
      
      // Also activate the product if it was inactive
      product.status.isActive = true;
      
      await product.save({ session });

      // Update category product count
      await this.updateCategoryProductCount(product.category);

      // Add to activity log (don't use session for this - separate operation)
      // await this.logProductActivity(productId, 'APPROVED', adminId, { notes });

      // Commit transaction
      await session.commitTransaction();
      
      // Close session
      await session.endSession();

      // Invalidate cache (outside transaction)
      await this.invalidateProductCache(productId);
      await this.invalidateProductListCache();

      // Emit event for vendor notification (outside transaction)
      eventEmitter.emit(EVENTS.PRODUCT.APPROVED, {
        productId: product._id,
        vendorId: product.vendor,
        productName: product.basicInfo.name,
        approvedBy: adminId,
        notes
      });

      return product;
    } catch (error) {
      // Only abort if transaction is still active
      if (session.transaction.isActive) {
        await session.abortTransaction();
      }
      // Close session
      await session.endSession();
      
      logger.error('Error in approveProduct:', error);
      throw error;
    }
  }

  /**
 * Get pending products for admin approval
 */
  async getPendingProducts(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = {
        'status.approvalStatus': 'pending',
        'status.isActive': true
      };
      
      // Add search filter
      if (filters.search) {
        query.$or = [
          { 'basicInfo.name': { $regex: filters.search, $options: 'i' } },
          { 'basicInfo.sku': { $regex: filters.search, $options: 'i' } },
          { 'basicInfo.brand': { $regex: filters.search, $options: 'i' } }
        ];
      }
      
      // Add category filter
      if (filters.category) {
        query.category = filters.category;
      }

      const [products, total] = await Promise.all([
        Product.find(query)
          .populate({
            path: 'vendor',
            select: 'business.name business.slug user',
            populate: {
              path: 'user',
              select: 'email profile.firstName profile.lastName'
            }
          })
          .populate('category', 'name slug')
          .select('basicInfo.name basicInfo.slug basicInfo.sku basicInfo.brand basicInfo.description pricing monthlyRent media.images condition ratings.average inventory.totalQuantity createdAt')
          .sort({ createdAt: 1 }) // Oldest first
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(query)
      ]);

      // Get vendor details for each product
      const productsWithDetails = await Promise.all(
        products.map(async (product) => {
          // Get vendor submission stats
          const vendorProductCount = await Product.countDocuments({ 
            vendor: product.vendor?._id 
          });
          
          const vendorApprovedCount = await Product.countDocuments({ 
            vendor: product.vendor?._id,
            'status.approvalStatus': 'approved'
          });
          
          return {
            ...product,
            vendor: {
              _id: product.vendor?._id,
              businessName: product.vendor?.business?.name || 'Unknown',
              ownerName: product.vendor?.user?.profile?.firstName 
                ? `${product.vendor.user.profile.firstName} ${product.vendor.user.profile.lastName || ''}`
                : product.vendor?.user?.email || 'Unknown',
              email: product.vendor?.user?.email,
              stats: {
                totalProducts: vendorProductCount,
                approvedProducts: vendorApprovedCount,
                approvalRate: vendorProductCount > 0 
                  ? Math.round((vendorApprovedCount / vendorProductCount) * 100) 
                  : 0
              }
            },
            waitingDays: Math.floor((Date.now() - new Date(product.createdAt)) / (1000 * 60 * 60 * 24))
          };
        })
      );

      return {
        products: productsWithDetails,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        summary: {
          totalPending: total,
          avgWaitingDays: productsWithDetails.reduce((acc, p) => acc + p.waitingDays, 0) / (productsWithDetails.length || 1)
        }
      };
    } catch (error) {
      logger.error('Error in getPendingProducts:', error);
      throw error;
    }
  }

  /**
   * Reject product (admin only)
   */
  async rejectProduct(productId, adminId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(productId).session(session);
      
      if (!product) {
        throw new AppError('Product not found', 404);
      }

      // Update product status
      product.status.isVerified = false;
      product.status.approvalStatus = 'rejected';
      product.status.rejectedAt = new Date();
      product.status.rejectedBy = adminId;
      product.status.rejectionReason = reason;
      product.status.isActive = false;
      
      await product.save({ session });

      // Add to activity log
      await this.logProductActivity(productId, 'REJECTED', adminId, { reason });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateProductCache(productId);
      await this.invalidateProductListCache();

      // Emit event for vendor notification
      eventEmitter.emit(EVENTS.PRODUCT.REJECTED, {
        productId: product._id,
        vendorId: product.vendor,
        productName: product.basicInfo.name,
        rejectedBy: adminId,
        reason
      });

      return product;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in rejectProduct:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Delete product
   */
  async deleteProduct(productId, vendorId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findOne({ 
        _id: productId,
        vendor: vendorId 
      }).session(session);

      if (!product) {
        throw new AppError('Product not found or unauthorized', 404);
      }

      // Check if product has active rentals
      const activeRentals = await Rental.countDocuments({
        product: productId,
        status: { $in: ['active', 'confirmed', 'delivered'] }
      }).session(session);

      if (activeRentals > 0) {
        throw new AppError('Cannot delete product with active rentals', 400);
      }

      // Delete inventory items
      await Inventory.deleteMany({ product: productId }, { session });

      // Delete the product
      await product.deleteOne({ session });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateProductCache(productId);

      // Emit event
      eventEmitter.emit(EVENTS.PRODUCT.DELETED, {
        productId,
        vendorId,
        productName: product.basicInfo.name
      });

      return { message: 'Product deleted successfully' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in deleteProduct:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Log product activity
   */
  async logProductActivity(productId, action, userId, metadata = {}) {
    try {
      const ProductActivity = require('../models/ProductActivity.model');
      await ProductActivity.create({
        product: productId,
        action,
        performedBy: userId,
        metadata,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error logging product activity:', error);
      // Don't throw - activity logging shouldn't break main flow
    }
  }


  /**
   * Search products with advanced filters
   */
  async searchProducts(query, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;
      
      const {
        q,
        category,
        minPrice,
        maxPrice,
        condition,
        brand,
        city,
        vendor,
        tags,
        sort = 'relevance',
        inStock = true,
        featured,
        rating,
        attributes
      } = query;

      // Build search query
      const searchQuery = { 'status.isActive': true };

      // Text search
      if (q) {
        searchQuery.$text = { $search: q };
      }

      // Category filter
      if (category) {
        const categoryIds = Array.isArray(category) ? category : [category];
        
        // Get all subcategories
        const allCategoryIds = await Category.find({
          $or: [
            { _id: { $in: categoryIds } },
            { parent: { $in: categoryIds } }
          ]
        }).distinct('_id');
        
        searchQuery.category = { $in: [...categoryIds, ...allCategoryIds] };
      }

      // Price range
      if (minPrice || maxPrice) {
        searchQuery['pricing.monthlyRent'] = {};
        if (minPrice) searchQuery['pricing.monthlyRent'].$gte = parseFloat(minPrice);
        if (maxPrice) searchQuery['pricing.monthlyRent'].$lte = parseFloat(maxPrice);
      }

      // Condition filter
      if (condition) {
        searchQuery.condition = { $in: Array.isArray(condition) ? condition : [condition] };
      }

      // Brand filter
      if (brand) {
        searchQuery['basicInfo.brand'] = { $in: Array.isArray(brand) ? brand : [brand] };
      }

      // Location filter (by vendor's serviceable cities)
      if (city) {
        const vendorsInCity = await Vendor.find({
          'addresses.serviceableCities': city
        }).distinct('user');
        searchQuery.vendor = { $in: vendorsInCity };
      }

      // Vendor filter
      if (vendor) {
        searchQuery.vendor = vendor;
      }

      // Tags filter
      if (tags) {
        const tagArray = Array.isArray(tags) ? tags : tags.split(',');
        searchQuery.tags = { $in: tagArray };
      }

      // In stock filter
      if (inStock) {
        searchQuery['inventory.availableQuantity'] = { $gt: 0 };
      }

      // Featured products
      if (featured) {
        searchQuery['status.isFeatured'] = true;
      }

      // Minimum rating
      if (rating) {
        searchQuery['ratings.average'] = { $gte: parseFloat(rating) };
      }

      // Attribute filters
      if (attributes) {
        const attrFilters = JSON.parse(attributes);
        Object.entries(attrFilters).forEach(([key, value]) => {
          searchQuery[`specifications.${key}`] = value;
        });
      }

      // Determine sort order
      let sortOption = {};
      switch (sort) {
        case 'price_asc':
          sortOption = { 'pricing.monthlyRent': 1 };
          break;
        case 'price_desc':
          sortOption = { 'pricing.monthlyRent': -1 };
          break;
        case 'newest':
          sortOption = { createdAt: -1 };
          break;
        case 'rating':
          sortOption = { 'ratings.average': -1, 'ratings.count': -1 };
          break;
        case 'popularity':
          sortOption = { 'views.count': -1, 'ratings.count': -1 };
          break;
        case 'relevance':
        default:
          if (q) {
            sortOption = { score: { $meta: 'textScore' } };
          } else {
            sortOption = { createdAt: -1 };
          }
      }

      // Execute search
      let productsQuery = Product.find(searchQuery)
        // .populate('vendor', 'business.name')
        .populate({
        path: 'vendor',
        select: 'business.name business.slug user',
        populate: {
          path: 'user',
          select: 'name email'
        }
      })
        .populate('category', 'name slug')
        .select('basicInfo.name basicInfo.slug basicInfo.sku basicInfo.brand status pricing monthlyRent media.images createdAt condition ratings.average vendor category inventory.availableQuantity');

      if (q) {
        productsQuery = productsQuery.select({ score: { $meta: 'textScore' } });
      }

      const [products, total, aggregations] = await Promise.all([
        productsQuery
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(searchQuery),
        this.getSearchAggregations(searchQuery)
      ]);
      

      // Get availability for each product
      const productsWithAvailability = await Promise.all(
        products.map(async (product) => {
          const availability = await this.checkAvailability(product._id);
          return {
            ...product,
            available: availability.available,
            availableQuantity: availability.availableQuantity
          };
        })
      );

      return {
        products: productsWithAvailability,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        aggregations
      };
    } catch (error) {
      logger.error('Error in searchProducts:', error);
      throw error;
    }
  }

  /**
   * Get search aggregations (filters)
   */
  async getSearchAggregations(baseQuery) {
    try {
      const [priceRange, brands, conditions, categories] = await Promise.all([
        // Price range
        Product.aggregate([
          { $match: baseQuery },
          {
            $group: {
              _id: null,
              minPrice: { $min: '$pricing.monthlyRent' },
              maxPrice: { $max: '$pricing.monthlyRent' }
            }
          }
        ]),

        // Available brands
        Product.aggregate([
          { $match: baseQuery },
          { $group: { 
            _id: '$basicInfo.brand', 
            count: { $sum: 1 } 
          }},
          { $match: { _id: { $ne: null } } },
          { $sort: { count: -1 } },
          { $limit: 20 }
        ]),

        // Available conditions
        Product.aggregate([
          { $match: baseQuery },
          { $group: { 
            _id: '$condition', 
            count: { $sum: 1 } 
          }},
          { $match: { _id: { $ne: null } } }
        ]),

        // Categories with counts
        Product.aggregate([
          { $match: baseQuery },
          { $group: { 
            _id: '$category', 
            count: { $sum: 1 } 
          }},
          { $sort: { count: -1 } },
          { $limit: 20 },
          {
            $lookup: {
              from: 'categories',
              localField: '_id',
              foreignField: '_id',
              as: 'category'
            }
          },
          { $unwind: '$category' },
          {
            $project: {
              _id: '$category._id',
              name: '$category.name',
              slug: '$category.slug',
              count: 1
            }
          }
        ])
      ]);

      return {
        price: {
          min: priceRange[0]?.minPrice || 0,
          max: priceRange[0]?.maxPrice || 100000
        },
        brands: brands.map(b => ({ name: b._id, count: b.count })),
        conditions: conditions.map(c => ({ name: c._id, count: c.count })),
        categories
      };
    } catch (error) {
      logger.error('Error in getSearchAggregations:', error);
      return {};
    }
  }

  /**
    * Get similar products
    */
  async getSimilarProducts(productId, limit = 5) {
    try {
      const product = await Product.findById(productId);
      if (!product) return [];

      const similarProducts = await Product.aggregate([
        {
          $match: {
            _id: { $ne: product._id },
            category: product.category,
            'status.isActive': true,
            condition: { $in: ['new', 'like-new', 'good'] }
          }
        },
        {
          $addFields: {
            // Convert boolean to number using $cond
            conditionMatch: {
              $cond: [{ $eq: ['$condition', product.condition] }, 1, 0]
            },
            // Calculate price difference score (negative because closer price is better)
            priceDiff: {
              $multiply: [
                { $abs: { $subtract: ['$pricing.monthlyRent', product.pricing.monthlyRent] } },
                -0.01
              ]
            },
            // Rating score
            ratingScore: {
              $multiply: [{ $ifNull: ['$ratings.average', 0] }, 5]
            }
          }
        },
        {
          $addFields: {
            relevanceScore: {
              $add: [
                { $multiply: ['$conditionMatch', 10] },  // Now conditionMatch is numeric
                '$priceDiff',
                '$ratingScore'
              ]
            }
          }
        },
        { $sort: { relevanceScore: -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            'basicInfo.name': 1,
            'basicInfo.slug': 1,
            'pricing.monthlyRent': 1,
            'media.images': 1,
            'ratings.average': 1,
            condition: 1,
            vendor: 1
          }
        }
      ]);

      return similarProducts;
    } catch (error) {
      logger.error('Error in getSimilarProducts:', error);
      return [];
    }
  }

  /**
   * Check product availability
   */
  async checkAvailability(productId) {
    try {
      const product = await Product.findById(productId)
        .select('inventory.availableQuantity inventory.totalQuantity status.isActive');

      if (!product) {
        return { available: false, reason: 'Product not found' };
      }

      if (!product.status.isActive) {
        return { available: false, reason: 'Product is not active' };
      }

      const available = product.inventory.availableQuantity > 0;

      return {
        available,
        availableQuantity: product.inventory.availableQuantity,
        totalQuantity: product.inventory.totalQuantity,
        nextAvailable: available ? null : await this.getNextAvailableDate(productId)
      };
    } catch (error) {
      logger.error('Error in checkAvailability:', error);
      return { available: false, error: error.message };
    }
  }

  /**
   * Get next available date for out-of-stock product
   */
  async getNextAvailableDate(productId) {
    try {
      const activeRentals = await Rental.find({
        product: productId,
        status: 'active'
      })
      .sort({ 'rentalDetails.endDate': 1 })
      .limit(1)
      .lean();

      if (activeRentals.length > 0) {
        return activeRentals[0].rentalDetails.endDate;
      }

      return null;
    } catch (error) {
      logger.error('Error in getNextAvailableDate:', error);
      return null;
    }
  }

  /**
   * Get product rental statistics
   */
  async getProductRentalStats(productId) {
    try {
      const stats = await Rental.aggregate([
        { $match: { product: productId } },
        {
          $group: {
            _id: null,
            totalRentals: { $sum: 1 },
            activeRentals: {
              $sum: { $cond: [{ $in: ['$status', ['active', 'confirmed']] }, 1, 0] }
            },
            completedRentals: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            averageRating: { $avg: '$rating' }
          }
        }
      ]);

      return stats[0] || {
        totalRentals: 0,
        activeRentals: 0,
        completedRentals: 0,
        averageRating: 0
      };
    } catch (error) {
      logger.error('Error in getProductRentalStats:', error);
      return {
        totalRentals: 0,
        activeRentals: 0,
        completedRentals: 0,
        averageRating: 0
      };
    }
  }

  /**
   * Update product stock
   */
  async updateStock(productId, quantity, operation = 'add') {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(productId).session(session);
      
      if (!product) {
        throw new AppError('Product not found', 404);
      }

      if (operation === 'add') {
        product.inventory.totalQuantity += quantity;
        product.inventory.availableQuantity += quantity;
      } else if (operation === 'remove') {
        if (product.inventory.availableQuantity < quantity) {
          throw new AppError('Insufficient stock', 400);
        }
        product.inventory.totalQuantity -= quantity;
        product.inventory.availableQuantity -= quantity;
      }

      await product.save({ session });

      // Update inventory items
      if (operation === 'add') {
        const sku = product.basicInfo.sku;
        const newItems = [];
        for (let i = 0; i < quantity; i++) {
          newItems.push({
            product: productId,
            sku: `${sku}-${String(product.inventory.totalQuantity + i + 1).padStart(3, '0')}`,
            status: 'available',
            condition: { status: product.condition }
          });
        }
        await Inventory.insertMany(newItems, { session });
      }

      await session.commitTransaction();

      return product;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateStock:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Bulk update products
   */
  async bulkUpdate(vendorId, updates) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const results = {
        successful: [],
        failed: []
      };

      for (const update of updates) {
        try {
          const { id, ...data } = update;
          const product = await Product.findOne({ 
            _id: id,
            vendor: vendorId 
          }).session(session);

          if (!product) {
            results.failed.push({ id, reason: 'Product not found or unauthorized' });
            continue;
          }

          Object.assign(product, data);
          product.metadata.updatedBy = vendorId;
          await product.save({ session });

          results.successful.push(id);
        } catch (error) {
          results.failed.push({ id: update.id, reason: error.message });
        }
      }

      await session.commitTransaction();

      // Invalidate cache for updated products
      for (const id of results.successful) {
        await this.invalidateProductCache(id);
      }

      return results;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in bulkUpdate:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get vendor products
   */
  async getVendorProducts(vendorId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { vendor: vendorId };
      
      if (filters.status) {
        query['status.isActive'] = filters.status === 'active';
      }
      
      if (filters.category) {
        query.category = filters.category;
      }
      
      if (filters.search) {
        query.$or = [
          { 'basicInfo.name': new RegExp(filters.search, 'i') },
          { 'basicInfo.sku': new RegExp(filters.search, 'i') }
        ];
      }

      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('category', 'name')
          .select('-specifications -metadata')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(query)
      ]);

      // Get inventory stats for each product
      const productsWithStats = await Promise.all(
        products.map(async (product) => {
          const [rentalCount, inventoryStats] = await Promise.all([
            Rental.countDocuments({ product: product._id }),
            Inventory.aggregate([
              { $match: { product: product._id } },
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 }
                }
              }
            ])
          ]);

          const stats = {
            totalRentals: rentalCount,
            inventory: inventoryStats.reduce((acc, stat) => {
              acc[stat._id] = stat.count;
              return acc;
            }, {})
          };

          return { ...product, stats };
        })
      );

      return {
        products: productsWithStats,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorProducts:', error);
      throw error;
    }
  }

  /**
   * Update category product count
   */
  async updateCategoryProductCount(categoryId) {
    try {
      const count = await Product.countDocuments({ 
        category: categoryId,
        'status.isActive': true 
      });

      await Category.findByIdAndUpdate(categoryId, { productCount: count });
    } catch (error) {
      logger.error('Error in updateCategoryProductCount:', error);
    }
  }

  /**
   * Invalidate product cache
   */
  async invalidateProductCache(productId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `product:${productId}`,
          `product:${productId}:*`,
          'products:search:*',
          'products:featured:*'
        ];
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating product cache:', error);
    }
  }

  /**
   * Get product recommendations for user
   */
  async getRecommendations(userId, limit = 10) {
    try {
      // Try AI recommendations first
      if (this.openai) {
        const aiRecs = await this.getAIRecommendations(userId, limit);
        if (aiRecs.length > 0) {
          return aiRecs;
        }
      }

      // Fallback to collaborative filtering
      const collabRecs = await this.getCollaborativeRecommendations(userId, limit);
      if (collabRecs.length > 0) {
        return collabRecs;
      }

      // Final fallback to popular products
      return this.getPopularProducts(limit);
    } catch (error) {
      logger.error('Error in getRecommendations:', error);
      return this.getPopularProducts(limit);
    }
  }

  /**
   * Get featured products
   */
  async getFeaturedProducts(limit = 10) {
    try {
      const cacheKey = `products:featured:${limit}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const products = await Product.find({
        'status.isActive': true,
        'status.isFeatured': true,
        'inventory.availableQuantity': { $gt: 0 }
      })
      .populate('vendor', 'business.name')
      .populate('category', 'name')
      .select('basicInfo.name basicInfo.slug pricing monthlyRent media.images ratings.average condition vendor category')
      .sort({ 'ratings.average': -1, createdAt: -1 })
      .limit(limit)
      .lean();

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 3600, JSON.stringify(products));
      }

      return products;
    } catch (error) {
      logger.error('Error in getFeaturedProducts:', error);
      return [];
    }
  }

  /**
   * Get products by category
   */
  async getProductsByCategory(categoryId, page = 1, limit = 10, filters = {}) {
    try {
      const category = await Category.findById(categoryId);
      if (!category) {
        throw new AppError('Category not found', 404);
      }

      // Get all subcategories
      const subcategories = await Category.find({
        $or: [
          { _id: categoryId },
          { parent: categoryId },
          { 'ancestors._id': categoryId }
        ]
      }).distinct('_id');

      const query = {
        category: { $in: subcategories },
        'status.isActive': true,
        'inventory.availableQuantity': { $gt: 0 }
      };

      // Apply additional filters
      if (filters.minPrice || filters.maxPrice) {
        query['pricing.monthlyRent'] = {};
        if (filters.minPrice) query['pricing.monthlyRent'].$gte = parseFloat(filters.minPrice);
        if (filters.maxPrice) query['pricing.monthlyRent'].$lte = parseFloat(filters.maxPrice);
      }

      if (filters.condition) {
        query.condition = { $in: Array.isArray(filters.condition) ? filters.condition : [filters.condition] };
      }

      if (filters.brand) {
        query['basicInfo.brand'] = { $in: Array.isArray(filters.brand) ? filters.brand : [filters.brand] };
      }

      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('vendor', 'business.name')
          .select('basicInfo.name basicInfo.slug basicInfo.brand pricing monthlyRent media.images condition ratings.average vendor')
          .sort(filters.sort === 'price_asc' ? { 'pricing.monthlyRent': 1 } : 
                filters.sort === 'price_desc' ? { 'pricing.monthlyRent': -1 } : 
                { createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Product.countDocuments(query)
      ]);

      return {
        category: {
          _id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description
        },
        products,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getProductsByCategory:', error);
      throw error;
    }
  }
}

module.exports = new ProductService();