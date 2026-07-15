// scripts/seed-categories.js
const mongoose = require('mongoose');
// const Category = require('../src/models/Category');
const categories = require('../seed/categories');
const Category = require('../src/models/Category.model');

async function seedCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb+srv://rick07539:iw5HHRv4JdunwlUR@cluster0.ffmnsa4.mongodb.net/rentEase?retryWrites=true&w=majority');
    console.log('Connected to MongoDB');

    // Clear existing categories
    await Category.deleteMany({});
    console.log('Cleared existing categories');

    // Insert categories
    const insertedCategories = await Category.insertMany(categories);
    console.log(`Inserted ${insertedCategories.length} parent categories`);

    // Verify insertion
    const count = await Category.countDocuments();
    console.log(`Total categories in database: ${count}`);

    // Display inserted categories
    const allCategories = await Category.find().select('name slug level isActive');
    console.log('\nInserted Categories:');
    console.table(allCategories.map(c => ({
      Name: c.name,
      Slug: c.slug,
      Level: c.level,
      Status: c.isActive ? 'Active' : 'Inactive'
    })));

  } catch (error) {
    console.error('Error seeding categories:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the seed function
seedCategories();