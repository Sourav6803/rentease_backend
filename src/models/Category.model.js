// // models/Category.model.js
// const mongoose = require('mongoose');

// const categorySchema = new mongoose.Schema({
//   name: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   slug: {
//     type: String,
//     required: true,
//     unique: true,
//     lowercase: true
//   },
//   description: String,
//   parent: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Category',
//     default: null,
//     index: true
//   },
//   ancestors: [{
//     _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
//     name: String,
//     slug: String,
//     level: Number
//   }],
//   level: {
//     type: Number,
//     default: 0
//   },
//   image: {
//     url: String,
//     thumbnail: String
//   },
//   icon: String,
//   meta: {
//     title: String,
//     description: String,
//     keywords: [String]
//   },
//   attributes: [{
//     name: String,
//     type: {
//       type: String,
//       enum: ['text', 'number', 'boolean', 'select', 'multiselect']
//     },
//     options: [String],
//     required: Boolean,
//     filterable: Boolean,
//     unit: String
//   }],
//   displayOrder: {
//     type: Number,
//     default: 0
//   },
//   isActive: {
//     type: Boolean,
//     default: true,
//     index: true
//   },
//   isFeatured: Boolean,
//   productCount: {
//     type: Number,
//     default: 0
//   },
//   children: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Category'
//   }],
//   metadata: {
//     createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//     updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
//   }
// }, {
//   timestamps: true
// });

// // Indexes
// // categorySchema.index({ slug: 1 });
// categorySchema.index({ parent: 1, displayOrder: 1 });

// // Pre-save middleware to generate slug and set level
// categorySchema.pre('save', async function(next) {
//   if (this.isModified('name') && !this.slug) {
//     this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
//   }
  
//   if (this.isModified('parent')) {
//     if (this.parent) {
//       const parent = await this.constructor.findById(this.parent);
//       this.ancestors = [...parent.ancestors, {
//         _id: parent._id,
//         name: parent.name,
//         slug: parent.slug,
//         level: parent.level
//       }];
//       this.level = parent.level + 1;
//     } else {
//       this.ancestors = [];
//       this.level = 0;
//     }
//   }
//   // next();
// });

// // Method to get all subcategories
// categorySchema.methods.getSubcategories = async function() {
//   return await this.constructor.find({
//     'ancestors._id': this._id
//   });
// };

// // Method to update product count
// categorySchema.methods.updateProductCount = async function() {
//   const Product = mongoose.model('Product');
//   this.productCount = await Product.countDocuments({ 
//     category: this._id,
//     'status.isActive': true 
//   });
//   await this.save();
// };

// module.exports = mongoose.model('Category', categorySchema);

// models/Category.model.js
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  description: String,
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true
  },
  ancestors: [{
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    name: String,
    slug: String,
    level: Number
  }],
  level: {
    type: Number,
    default: 0
  },
  image: {
    url: String,
    thumbnail: String
  },
  icon: String,
  meta: {
    title: String,
    description: String,
    keywords: [String]
  },
  attributes: [{
    name: String,
    type: {
      type: String,
      enum: ['text', 'number', 'boolean', 'select', 'multiselect']
    },
    options: [String],
    required: Boolean,
    filterable: Boolean,
    unit: String
  }],
  displayOrder: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isFeatured: Boolean,
  productCount: {
    type: Number,
    default: 0
  },
  children: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    aiGenerated: { type: Boolean, default: false },
    generatedAt: Date,
    suggestions: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
}); 

// Indexes
// categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1, displayOrder: 1 });
categorySchema.index({ 'ancestors._id': 1 });

// Pre-save middleware to generate slug and set level - FIXED
categorySchema.pre('save', async function(next) {
  try {
    // Generate slug if name is modified and slug doesn't exist
    if (this.isModified('name') && !this.slug) {
      let baseSlug = this.name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      
      // Check if slug already exists
      let slug = baseSlug;
      let counter = 1;
      let existingCategory = await this.constructor.findOne({ slug: slug });
      
      while (existingCategory && existingCategory._id.toString() !== this._id?.toString()) {
        slug = `${baseSlug}-${counter}`;
        existingCategory = await this.constructor.findOne({ slug: slug });
        counter++;
      }
      
      this.slug = slug;
    }
    
    // Handle parent relationship - FIXED with proper null checking
    if (this.isModified('parent')) {
      // Check if parent exists and is not null/undefined
      if (this.parent && this.parent.toString() !== '') {
        const parent = await this.constructor.findById(this.parent);
        
        // If parent exists, set ancestors and level
        if (parent) {
          // Build ancestors array from parent
          const parentAncestors = parent.ancestors || [];
          this.ancestors = [...parentAncestors, {
            _id: parent._id,
            name: parent.name,
            slug: parent.slug,
            level: parent.level || 0
          }];
          this.level = (parent.level || 0) + 1;
        } else {
          // Parent doesn't exist in database, treat as no parent
          console.warn(`Parent category ${this.parent} not found, setting to null`);
          this.parent = null;
          this.ancestors = [];
          this.level = 0;
        }
      } else {
        // No parent, reset ancestors and level
        this.parent = null;
        this.ancestors = [];
        this.level = 0;
      }
    }
    
    // next();
  } catch (error) {
    console.error('Error in category pre-save middleware:', error);
    // Don't let middleware fail the save, just log and continue
    this.parent = null;
    this.ancestors = [];
    this.level = 0;
    // next();
  }
});

// Post-save middleware to update children array on parent
categorySchema.post('save', async function(doc) {
  try {
    if (doc.parent) {
      await this.constructor.findByIdAndUpdate(doc.parent, {
        $addToSet: { children: doc._id }
      });
    }
  } catch (error) {
    console.error('Error updating parent children:', error);
  }
});

// Method to get all subcategories
categorySchema.methods.getSubcategories = async function() {
  return await this.constructor.find({
    'ancestors._id': this._id
  });
};

// Method to update product count
categorySchema.methods.updateProductCount = async function() {
  const Product = mongoose.model('Product');
  this.productCount = await Product.countDocuments({ 
    category: this._id,
    'status.isActive': true 
  });
  await this.save();
};

// Static method to get category tree
categorySchema.statics.getCategoryTree = async function() {
  const categories = await this.find().sort({ level: 1, displayOrder: 1 });
  
  const buildTree = (parentId = null) => {
    return categories
      .filter(cat => {
        const catParent = cat.parent ? cat.parent.toString() : null;
        const targetParent = parentId ? parentId.toString() : null;
        return catParent === targetParent;
      })
      .map(cat => ({
        ...cat.toObject(),
        children: buildTree(cat._id)
      }));
  };
  
  return buildTree();
};

module.exports = mongoose.model('Category', categorySchema);