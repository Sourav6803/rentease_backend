const { Category, Product } = require('../models');
const { AppError } = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const slugify = require('slugify');

class CategoryService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 3600; // 1 hour
  }

  /**
   * Generate unique slug
   */
  async generateSlug(name, parentId = null) {
    let slug = slugify(name, { lower: true, strict: true });
    
    // Check if slug exists
    const query = { slug };
    if (parentId) {
      query.parent = parentId;
    }
    
    const existingCategory = await Category.findOne(query);
    if (!existingCategory) {
      return slug;
    }
    
    // If slug exists, append number
    let counter = 1;
    let newSlug = `${slug}-${counter}`;
    while (await Category.findOne({ slug: newSlug, parent: parentId })) {
      counter++;
      newSlug = `${slug}-${counter}`;
    }
    
    return newSlug;
  }

  /**
 * Build category tree
 */
  buildCategoryTree(categories, parentId = null) {
    const tree = [];
    
    for (const category of categories) {
      // Compare parent IDs properly
      const categoryParent = category.parent ? category.parent.toString() : null;
      const targetParent = parentId ? parentId.toString() : null;
      
      if (categoryParent === targetParent) {
        // Find children recursively
        const children = this.buildCategoryTree(categories, category._id);
        
        // Create a copy to avoid mutating the original
        const categoryCopy = { ...category };
        
        if (children.length > 0) {
          categoryCopy.children = children;
        }
        
        tree.push(categoryCopy);
      }
    }
    
    return tree;
  }

  /**
   * Get all categories with tree structure
   */
  async getAllCategories(includeInactive = false) {
    try {
      const cacheKey = `categories:all:${includeInactive}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const query = includeInactive ? {} : { isActive: true };
      
      const categories = await Category.find(query)
        .sort({ displayOrder: 1, name: 1 })
        .lean();

      // Build tree
      const categoryTree = this.buildCategoryTree(categories);

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, this.defaultTTL, JSON.stringify(categoryTree));
      }

      return categoryTree;
    } catch (error) {
      logger.error('Error in getAllCategories:', error);
      throw error;
    }
  }

  /**
 * Get all categories with pagination and filters (for admin listing)
 */
  async getAllCategoriesWithPagination(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;
      
      const query = {};
      if (filters.isActive !== undefined) query.isActive = filters.isActive === 'true';
      if (filters.parent) query.parent = filters.parent === 'null' ? null : filters.parent;
      if (filters.search) {
        query.$or = [
          { name: new RegExp(filters.search, 'i') },
          { description: new RegExp(filters.search, 'i') }
        ];
      }

      const [categories, total] = await Promise.all([
        Category.find(query)
          .populate('parent', 'name slug')
          .populate('children', 'name slug productCount')
          .sort({ displayOrder: 1, name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Category.countDocuments(query)
      ]);

      return {
        categories,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getAllCategoriesWithPagination:', error);
      throw error;
    }
  }

  /**
   * Get category tree formatted for select dropdown
   */
  async getCategoryTreeForSelect(excludeId = null) {
    try {
      const cacheKey = `category:tree:select${excludeId ? `:exclude:${excludeId}` : ''}`;
      
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const categories = await Category.find({ isActive: true })
        .select('name slug parent')
        .sort({ displayOrder: 1, name: 1 })
        .lean();

      const buildOptions = (parentId = null, level = 0) => {
        const options = [];
        
        for (const cat of categories) {
          const catParent = cat.parent ? cat.parent.toString() : null;
          const targetParent = parentId ? parentId.toString() : null;
          
          if (catParent === targetParent) {
            // Skip the category being edited to prevent self-reference
            if (excludeId && cat._id.toString() === excludeId) {
              continue;
            }
            
            options.push({
              value: cat._id,
              label: '—'.repeat(level) + (level > 0 ? ' ' : '') + cat.name,
              level
            });
            
            options.push(...buildOptions(cat._id, level + 1));
          }
        }
        
        return options;
      };

      const tree = [
        { value: null, label: 'None (Root Category)', level: 0 },
        ...buildOptions()
      ];

      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 1800, JSON.stringify(tree));
      }

      return tree;
    } catch (error) {
      logger.error('Error in getCategoryTreeForSelect:', error);
      return [{ value: null, label: 'None (Root Category)', level: 0 }];
    }
  }

  /**
   * Validate category data before save
   */
  validateCategoryData(data, isUpdate = false) {
    const errors = [];
    
    if (!isUpdate) {
      if (!data.name || data.name.trim().length < 2) {
        errors.push('Category name must be at least 2 characters');
      }
      if (data.name && data.name.length > 50) {
        errors.push('Category name cannot exceed 50 characters');
      }
    }
    
    if (data.description && data.description.length > 500) {
      errors.push('Description cannot exceed 500 characters');
    }
    
    if (data.meta?.title && data.meta.title.length > 60) {
      errors.push('Meta title cannot exceed 60 characters');
    }
    
    if (data.meta?.description && data.meta.description.length > 160) {
      errors.push('Meta description cannot exceed 160 characters');
    }
    
    if (data.attributes && Array.isArray(data.attributes)) {
      for (const attr of data.attributes) {
        if (!attr.name || attr.name.trim() === '') {
          errors.push('Attribute name is required');
        }
        if (attr.type === 'select' || attr.type === 'multiselect') {
          if (!attr.options || attr.options.length === 0) {
            errors.push(`Attribute "${attr.name}" requires options`);
          }
        }
      }
    }
    
    return errors;
  }

  /**
   * Get category by ID with full details (for editing)
   */
  async getCategoryById(id) {
    try {
      const cacheKey = `category:detail:${id}`;
      
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const category = await Category.findById(id)
        .populate('parent', 'name slug')
        .populate('children', 'name slug productCount')
        .lean();

      if (!category) {
        throw new AppError('Category not found', 404);
      }

      // Get breadcrumbs
      const breadcrumbs = await this.getCategoryBreadcrumbs(id);

      const result = {
        ...category,
        breadcrumbs,
        meta: category.meta || {},
        attributes: category.attributes || []
      };

      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 1800, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      logger.error('Error in getCategoryById:', error);
      throw error;
    }
  }

  /**
   * Get category statistics (enhanced)
   */
  async getCategoryStats() {
    try {
      const cacheKey = 'category:stats';
      
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const [
        total,
        active,
        inactive,
        withChildren,
        byLevel,
        topCategories
      ] = await Promise.all([
        Category.countDocuments(),
        Category.countDocuments({ isActive: true }),
        Category.countDocuments({ isActive: false }),
        Category.countDocuments({ children: { $exists: true, $not: { $size: 0 } } }),
        Category.aggregate([
          { $group: { _id: '$level', count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ]),
        Category.aggregate([
          { $match: { isActive: true } },
          { $sort: { productCount: -1 } },
          { $limit: 5 },
          { $project: { name: 1, slug: 1, productCount: 1 } }
        ])
      ]);

      const stats = {
        total,
        active,
        inactive,
        withChildren,
        withoutChildren: total - withChildren,
        byLevel: byLevel.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {}),
        topCategories
      };

      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 3600, JSON.stringify(stats));
      }

      return stats;
    } catch (error) {
      logger.error('Error in getCategoryStats:', error);
      return {
        total: 0,
        active: 0,
        inactive: 0,
        withChildren: 0,
        withoutChildren: 0,
        byLevel: {},
        topCategories: []
      };
    }
  }

  /**
   * Check if slug is available
   */
  async checkSlugAvailability(slug, excludeId = null) {
    try {
      const query = { slug };
      if (excludeId) {
        query._id = { $ne: excludeId };
      }
      
      const existing = await Category.findOne(query);
      return {
        available: !existing,
        suggested: existing ? `${slug}-${Date.now()}` : slug
      };
    } catch (error) {
      logger.error('Error in checkSlugAvailability:', error);
      return { available: false, suggested: slug };
    }
  }

  /**
   * Get category by ID or slug
   */
  async getCategory(identifier) {
    try {
      const cacheKey = `category:${identifier}`;
      
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
        : { slug: identifier };
      
      const category = await Category.findOne(query)
        .populate('parent', 'name slug')
        .lean();

      if (!category) {
        throw new AppError('Category not found', 404);
      }

      // Get subcategories
      const subcategories = await Category.find({ 
        parent: category._id,
        isActive: true 
      })
      .select('name slug image description productCount')
      .sort({ displayOrder: 1, name: 1 })
      .lean();

      // Get parent hierarchy
      const ancestors = [];
      let currentParent = category.parent;
      while (currentParent) {
        ancestors.unshift({
          _id: currentParent._id,
          name: currentParent.name,
          slug: currentParent.slug
        });
        currentParent = currentParent.parent;
      }

      const result = {
        ...category,
        ancestors,
        subcategories,
        productCount: category.productCount || 0
      };

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, this.defaultTTL, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      logger.error('Error in getCategory:', error);
      throw error;
    }
  }

  /**
   * Create new category
   */
  async createCategory(categoryData, userId) {
    try {
      const { name, parent, description, image, displayOrder, attributes } = categoryData;

      // Generate slug
      const slug = await this.generateSlug(name, parent);

      // If parent is provided, check if it exists
      if (parent) {
        const parentCategory = await Category.findById(parent);
        if (!parentCategory) {
          throw new AppError('Parent category not found', 404);
        }
      }

      // Create category
      const category = await Category.create({
        name,
        slug,
        description,
        parent: parent || null,
        image,
        displayOrder: displayOrder || 0,
        attributes: attributes || [],
        metadata: {
          createdBy: userId
        }
      });

      // Invalidate cache
      await this.invalidateCategoryCache();

      // Emit event
      eventEmitter.emit('category:created', {
        categoryId: category._id,
        name: category.name,
        slug: category.slug,
        createdBy: userId
      });

      return category;
    } catch (error) {
      logger.error('Error in createCategory:', error);
      throw error;
    }
  }

  /**
   * Update category
   */
  async updateCategory(categoryId, updateData, userId) {
    try {
      const category = await Category.findById(categoryId);
      
      if (!category) {
        throw new AppError('Category not found', 404);
      }

      // If name is being updated, regenerate slug
      if (updateData.name && updateData.name !== category.name) {
        updateData.slug = await this.generateSlug(updateData.name, updateData.parent || category.parent);
      }

      // If parent is being updated, check if new parent exists
      if (updateData.parent && updateData.parent !== String(category.parent)) {
        if (updateData.parent === categoryId) {
          throw new AppError('Category cannot be its own parent', 400);
        }

        const parentCategory = await Category.findById(updateData.parent);
        if (!parentCategory) {
          throw new AppError('Parent category not found', 404);
        }

        // Check for circular reference
        let currentParent = parentCategory;
        while (currentParent.parent) {
          if (String(currentParent.parent) === categoryId) {
            throw new AppError('Circular reference detected in category hierarchy', 400);
          }
          currentParent = await Category.findById(currentParent.parent);
        }
      }

      // Update fields
      Object.assign(category, updateData);
      category.metadata.updatedBy = userId;
      
      await category.save();

      // Update product counts for affected categories
      await this.updateProductCount(categoryId);
      if (category.parent) {
        await this.updateProductCount(category.parent);
      }

      // Invalidate cache
      await this.invalidateCategoryCache(categoryId);

      // Emit event
      eventEmitter.emit('category:updated', {
        categoryId: category._id,
        name: category.name,
        slug: category.slug,
        updatedBy: userId,
        changes: Object.keys(updateData)
      });

      return category;
    } catch (error) {
      logger.error('Error in updateCategory:', error);
      throw error;
    }
  }

  /**
   * Delete category
   */
  async deleteCategory(categoryId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const category = await Category.findById(categoryId).session(session);
      
      if (!category) {
        throw new AppError('Category not found', 404);
      }

      // Check if category has products
      const productCount = await Product.countDocuments({ category: categoryId }).session(session);
      if (productCount > 0) {
        throw new AppError('Cannot delete category with existing products', 400);
      }

      // Check if category has subcategories
      const subcategoryCount = await Category.countDocuments({ parent: categoryId }).session(session);
      if (subcategoryCount > 0) {
        throw new AppError('Cannot delete category with subcategories', 400);
      }

      await category.deleteOne({ session });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateCategoryCache(categoryId);

      // Emit event
      eventEmitter.emit('category:deleted', {
        categoryId: category._id,
        name: category.name,
        deletedBy: userId
      });

      return { message: 'Category deleted successfully' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in deleteCategory:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get category products
   */
  async getCategoryProducts(categoryId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      // Get category and all subcategories
      const category = await Category.findById(categoryId);
      if (!category) {
        throw new AppError('Category not found', 404);
      }

      // Get all subcategory IDs
      const subcategories = await Category.find({ 
        $or: [
          { _id: categoryId },
          { parent: categoryId },
          { 'ancestors._id': categoryId }
        ]
      }).distinct('_id');

      const query = { 
        category: { $in: subcategories },
        'status.isActive': true 
      };

      // Apply additional filters
      if (filters.minPrice || filters.maxPrice) {
        query['pricing.monthlyRent'] = {};
        if (filters.minPrice) query['pricing.monthlyRent'].$gte = parseFloat(filters.minPrice);
        if (filters.maxPrice) query['pricing.monthlyRent'].$lte = parseFloat(filters.maxPrice);
      }

      if (filters.brand) {
        query['basicInfo.brand'] = filters.brand;
      }

      if (filters.condition) {
        query.condition = { $in: filters.condition.split(',') };
      }

      if (filters.attributes) {
        // Parse and apply attribute filters
        const attributes = JSON.parse(filters.attributes);
        Object.entries(attributes).forEach(([key, value]) => {
          query[`specifications.${key}`] = value;
        });
      }

      // Determine sort order
      let sort = {};
      switch (filters.sort) {
        case 'price_asc':
          sort = { 'pricing.monthlyRent': 1 };
          break;
        case 'price_desc':
          sort = { 'pricing.monthlyRent': -1 };
          break;
        case 'newest':
          sort = { createdAt: -1 };
          break;
        case 'rating':
          sort = { 'ratings.average': -1 };
          break;
        case 'popularity':
          sort = { 'ratings.count': -1 };
          break;
        default:
          sort = { createdAt: -1 };
      }

      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('vendor', 'business.name')
          .select('basicInfo.name basicInfo.slug pricing monthlyRent media.images ratings.average vendor condition')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(query)
      ]);

      // Get filter options for this category
      const filterOptions = await this.getCategoryFilterOptions(categoryId, query);

      return {
        category: {
          _id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          image: category.image
        },
        products,
        filters: filterOptions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getCategoryProducts:', error);
      throw error;
    }
  }

  /**
   * Get filter options for category
   */
  async getCategoryFilterOptions(categoryId, baseQuery = {}) {
    try {
      const cacheKey = `category:filters:${categoryId}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Get category with its attributes
      const category = await Category.findById(categoryId);
      if (!category) {
        return {};
      }

      // Get all subcategories
      const subcategories = await Category.find({ 
        $or: [
          { _id: categoryId },
          { parent: categoryId },
          { 'ancestors._id': categoryId }
        ]
      }).distinct('_id');

      const productQuery = { 
        category: { $in: subcategories },
        'status.isActive': true 
      };

      const [priceRange, brands, conditions, attributeValues] = await Promise.all([
        // Price range
        Product.aggregate([
          { $match: productQuery },
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
          { $match: productQuery },
          { $group: { _id: '$basicInfo.brand', count: { $sum: 1 } } },
          { $match: { _id: { $ne: null } } },
          { $sort: { count: -1 } },
          { $limit: 20 }
        ]),

        // Available conditions
        Product.aggregate([
          { $match: productQuery },
          { $group: { _id: '$condition', count: { $sum: 1 } } },
          { $match: { _id: { $ne: null } } }
        ]),

        // Attribute values (if category has defined attributes)
        category.attributes && category.attributes.length > 0
          ? Promise.all(category.attributes.map(async (attr) => {
              const values = await Product.aggregate([
                { $match: productQuery },
                { $group: { 
                  _id: `$specifications.${attr.name}`,
                  count: { $sum: 1 }
                }},
                { $match: { _id: { $ne: null } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
              ]);
              return {
                name: attr.name,
                type: attr.type,
                options: values.map(v => ({ value: v._id, count: v.count }))
              };
            }))
          : []
      ]);

      const filterOptions = {
        price: {
          min: priceRange[0]?.minPrice || 0,
          max: priceRange[0]?.maxPrice || 100000
        },
        brands: brands.map(b => ({ name: b._id, count: b.count })),
        conditions: conditions.map(c => ({ name: c._id, count: c.count })),
        attributes: attributeValues
      };

      // Cache the result (shorter TTL for filters)
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 1800, JSON.stringify(filterOptions)); // 30 minutes
      }

      return filterOptions;
    } catch (error) {
      logger.error('Error in getCategoryFilterOptions:', error);
      return {};
    }
  }

  /**
   * Get category breadcrumbs
   */
  async getCategoryBreadcrumbs(categoryId) {
    try {
      const breadcrumbs = [];
      let currentId = categoryId;

      while (currentId) {
        const category = await Category.findById(currentId).select('name slug parent');
        if (!category) break;

        breadcrumbs.unshift({
          _id: category._id,
          name: category.name,
          slug: category.slug
        });

        currentId = category.parent;
      }

      return breadcrumbs;
    } catch (error) {
      logger.error('Error in getCategoryBreadcrumbs:', error);
      return [];
    }
  }

  /**
   * Update product count for category
   */
  async updateProductCount(categoryId) {
    try {
      const count = await Product.countDocuments({ 
        category: categoryId,
        'status.isActive': true 
      });

      await Category.findByIdAndUpdate(categoryId, { productCount: count });

      // Update ancestor counts
      const category = await Category.findById(categoryId);
      if (category && category.parent) {
        await this.updateProductCount(category.parent);
      }
    } catch (error) {
      logger.error('Error in updateProductCount:', error);
    }
  }

  /**
   * Reorder categories
   */
  async reorderCategories(orderedIds) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updatePromises = orderedIds.map((id, index) => 
        Category.findByIdAndUpdate(
          id,
          { displayOrder: index },
          { session }
        )
      );

      await Promise.all(updatePromises);

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateCategoryCache();

      return { message: 'Categories reordered successfully' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in reorderCategories:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Bulk update categories
   */
  async bulkUpdate(updates, userId) {
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
          const category = await Category.findById(id).session(session);
          
          if (!category) {
            results.failed.push({ id, reason: 'Category not found' });
            continue;
          }

          Object.assign(category, data);
          category.metadata.updatedBy = userId;
          await category.save({ session });

          results.successful.push(id);
        } catch (error) {
          results.failed.push({ id: update.id, reason: error.message });
        }
      }

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateCategoryCache();

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
   * Get category statistics
   */
  async getCategoryStats() {
    try {
      const stats = await Category.aggregate([
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: 'category',
            as: 'products'
          }
        },
        {
          $project: {
            name: 1,
            slug: 1,
            isActive: 1,
            level: 1,
            productCount: { $size: '$products' },
            activeProductCount: {
              $size: {
                $filter: {
                  input: '$products',
                  as: 'product',
                  cond: { $eq: ['$$product.status.isActive', true] }
                }
              }
            }
          }
        },
        { $sort: { level: 1, name: 1 } }
      ]);

      const totals = {
        totalCategories: stats.length,
        activeCategories: stats.filter(c => c.isActive).length,
        totalProducts: stats.reduce((sum, c) => sum + c.productCount, 0),
        activeProducts: stats.reduce((sum, c) => sum + c.activeProductCount, 0),
        byLevel: stats.reduce((acc, c) => {
          acc[c.level] = (acc[c.level] || 0) + 1;
          return acc;
        }, {})
      };

      return { categories: stats, totals };
    } catch (error) {
      logger.error('Error in getCategoryStats:', error);
      throw error;
    }
  }

  /**
   * Invalidate category cache
   */
  async invalidateCategoryCache(categoryId = null) {
    try {
      if (this.redisClient) {
        const patterns = ['categories:*'];
        if (categoryId) {
          patterns.push(`category:${categoryId}`);
          patterns.push(`category:filters:${categoryId}`);
        }
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating category cache:', error);
    }
  }

  /**
   * Import categories from array
  */
  async importCategories(categories, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const results = {
        created: [],
        updated: [],
        failed: []
      };

      for (const catData of categories) {
        try {
          const { name, slug, parent, ...data } = catData;
          
          // Find existing category by slug
          let category = await Category.findOne({ slug }).session(session);
          
          if (category) {
            // Update existing
            Object.assign(category, data);
            category.metadata.updatedBy = userId;
            await category.save({ session });
            results.updated.push(category._id);
          } else {
            // Create new
            const newSlug = slug || await this.generateSlug(name);
            category = await Category.create([{
              name,
              slug: newSlug,
              parent: parent || null,
              ...data,
              metadata: { createdBy: userId }
            }], { session });
            results.created.push(category[0]._id);
          }
        } catch (error) {
          results.failed.push({ name: catData.name, reason: error.message });
        }
      }

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateCategoryCache();

      return results;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in importCategories:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Export categories
  */
  async exportCategories(format = 'json') {
    try {
      const categories = await Category.find()
        .populate('parent', 'name slug')
        .sort({ level: 1, displayOrder: 1, name: 1 })
        .lean();

      if (format === 'csv') {
        // Flatten for CSV
        return categories.map(c => ({
          id: c._id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          parent: c.parent?.name || '',
          level: c.level,
          isActive: c.isActive,
          productCount: c.productCount,
          displayOrder: c.displayOrder
        }));
      }

      return categories;
    } catch (error) {
      logger.error('Error in exportCategories:', error);
      throw error;
    }
  }

  /**
   * Generate category icon using OpenAI DALL-E
  */
  async generateCategoryIconWithOpenAI(categoryName, description = '') {
    try {
      // Build prompt for DALL-E
      const prompt = this.buildDallePrompt(categoryName, description);
      
      logger.info(`Generating icon for category: ${categoryName} with OpenAI`);
      
      // Call OpenAI DALL-E API
      const response = await this.openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "hd",
        style: "vivid",
      });

      const imageUrl = response.data[0].url;
      
      // Download the image
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data, 'binary');
      
      // Optimize and resize the image
      const optimizedBuffer = await sharp(imageBuffer)
        .resize(200, 200, { fit: 'cover' })
        .png({ quality: 80 })
        .toBuffer();
      
      // Upload to Cloudinary
      const uploadResult = await this.uploadToCloudinary(
        optimizedBuffer, 
        `categories/${categoryName.toLowerCase().replace(/\s/g, '-')}-${Date.now()}`
      );
      
      return {
        success: true,
        url: uploadResult.secure_url,
        thumbnail: uploadResult.secure_url.replace('/upload/', '/upload/w_100,h_100,c_fill/'),
        originalUrl: imageUrl,
        metadata: {
          category: categoryName,
          generatedBy: 'OpenAI DALL-E',
          prompt: prompt,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Error generating category icon with OpenAI:', error);
      // Fallback to Gemini or default icon
      return this.generateCategoryIconWithGemini(categoryName, description);
    }
  }

  /**
   * Build DALL-E prompt for e-commerce style category icon
   */
  buildDallePrompt(categoryName, description) {
    return `Create a professional, modern e-commerce category icon for "${categoryName}" in the style of Amazon and Flipkart.

Key requirements:
- Clean, minimalist flat design
- Bold, vibrant colors (use gradients #0EA5E9, #8B5CF6, #F59E0B)
- Square format with rounded corners (like app icons)
- White or light background with subtle shadow
- Simple, recognizable symbol representing ${categoryName}
- Professional, premium look suitable for a rental marketplace
- No text, just the icon symbol
- High quality, sharp edges, vector-like appearance

${description ? `Additional context: ${description}` : ''}

The icon should be instantly recognizable as representing ${categoryName} category.
Style reference: Amazon category icons, Flipkart category icons, modern e-commerce platforms.`;
  }

  /**
   * Generate category icon using Gemini (fallback)
   */
  async generateCategoryIconWithGemini(categoryName, description = '') {
    try {
      // Generate SVG using Gemini
      const prompt = this.buildGeminiIconPrompt(categoryName, description);
      
      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      let svgText = response.text();
      
      // Clean up SVG (remove markdown code blocks if present)
      svgText = svgText.replace(/```svg\n?/g, '');
      svgText = svgText.replace(/```\n?/g, '');
      svgText = svgText.trim();
      
      // Validate SVG
      if (!svgText.startsWith('<svg')) {
        throw new Error('Invalid SVG generated');
      }
      
      // Convert SVG to PNG
      const pngBuffer = await this.svgToPng(svgText);
      
      if (!pngBuffer) {
        return this.getDefaultIconData(categoryName);
      }
      
      // Upload to Cloudinary
      const uploadResult = await this.uploadToCloudinary(
        pngBuffer, 
        `categories/${categoryName.toLowerCase().replace(/\s/g, '-')}-${Date.now()}`
      );
      
      return {
        success: true,
        url: uploadResult.secure_url,
        thumbnail: uploadResult.secure_url.replace('/upload/', '/upload/w_100,h_100,c_fill/'),
        svg: svgText,
        metadata: {
          category: categoryName,
          generatedBy: 'Gemini AI',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Error generating category icon with Gemini:', error);
      return this.getDefaultIconData(categoryName);
    }
  }

  /**
   * Build Gemini prompt for SVG icon generation
   */
  buildGeminiIconPrompt(categoryName, description) {
    return `Generate an SVG icon for "${categoryName}" category in modern e-commerce style (like Amazon/Flipkart).

Requirements:
- 100x100px viewBox
- Rounded rectangle background (rx="20")
- Gradient background using colors: #0EA5E9 to #8B5CF6
- White or contrasting foreground symbol representing ${categoryName}
- Clean, minimalist, professional design
- No text, just the icon symbol
- Flat design with subtle shadows

${description ? `Additional context: ${description}` : ''}

Return ONLY the SVG code, no markdown or explanations.`;
  }

  /**
   * Main icon generation method - tries OpenAI first, falls back to Gemini
   */
  async generateCategoryIcon(categoryName, description = '') {
    // Try OpenAI DALL-E first if available
    if (this.openai) {
      const result = await this.generateCategoryIconWithOpenAI(categoryName, description);
      if (result.success) {
        return result;
      }
    }
    
    // Fallback to Gemini
    if (this.geminiModel) {
      return this.generateCategoryIconWithGemini(categoryName, description);
    }
    
    // Ultimate fallback
    return this.getDefaultIconData(categoryName);
  }
}

module.exports = new CategoryService();