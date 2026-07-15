#!/usr/bin/env node

/**
 * Database Seeding Script
 * Usage: npm run seed
 * Options: 
 *   --env=production - seed production database
 *   --clear - clear existing data before seeding
 *   --users=50 - number of users to seed
 *   --products=100 - number of products to seed
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { faker } = require('@faker-js/faker');
const chalk = require('chalk');
const ProgressBar = require('progress');
const commandLineArgs = require('command-line-args');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const {
  User,
  Admin,
  Vendor,
  Product,
  Category,
  Rental,
  Payment,
  Inventory,
  Address,
  Review,
  Discount,
  Notification,
} = require('../src/models');

const logger = console;

// Command line options
const options = commandLineArgs([
  { name: 'env', type: String, defaultValue: 'development' },
  { name: 'clear', type: Boolean, defaultValue: false },
  { name: 'users', type: Number, defaultValue: 50 },
  { name: 'products', type: Number, defaultValue: 100 },
  { name: 'rentals', type: Number, defaultValue: 200 },
  { name: 'help', type: Boolean, defaultValue: false },
]);

if (options.help) {
  console.log(`
  Usage: node scripts/seed.js [options]

  Options:
    --env=development    Environment to seed (development/production)
    --clear             Clear existing data before seeding
    --users=50          Number of users to create
    --products=100      Number of products to create
    --rentals=200       Number of rentals to create
    --help              Show this help message
  `);
  process.exit(0);
}

// Configuration
const config = {
  uri: options.env === 'production' 
    ? process.env.MONGODB_URI_PROD 
    : process.env.MONGODB_URI || 'mongodb://localhost:27017/rentease',
  clear: options.clear,
  counts: {
    users: options.users,
    vendors: Math.floor(options.users * 0.2), // 20% vendors
    admins: 3,
    categories: 15,
    products: options.products,
    rentals: options.rentals,
    reviews: Math.floor(options.rentals * 0.6), // 60% rentals have reviews
  },
};

// Indian cities and pincodes
const INDIAN_CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  { city: 'Delhi', state: 'Delhi', pincode: '110001' },
  { city: 'Bangalore', state: 'Karnataka', pincode: '560001' },
  { city: 'Hyderabad', state: 'Telangana', pincode: '500001' },
  { city: 'Ahmedabad', state: 'Gujarat', pincode: '380001' },
  { city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
  { city: 'Kolkata', state: 'West Bengal', pincode: '700001' },
  { city: 'Pune', state: 'Maharashtra', pincode: '411001' },
  { city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
  { city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001' },
];

// Product categories with attributes
const PRODUCT_CATEGORIES = [
  {
    name: 'Sofas',
    slug: 'sofas',
    attributes: [
      { name: 'Material', type: 'select', options: ['Leather', 'Fabric', 'Velvet', 'Wood'] },
      { name: 'Seating Capacity', type: 'select', options: ['1 Seater', '2 Seater', '3 Seater', 'L-Shape'] },
      { name: 'Style', type: 'select', options: ['Modern', 'Traditional', 'Contemporary', 'Minimalist'] },
    ],
  },
  {
    name: 'Beds',
    slug: 'beds',
    attributes: [
      { name: 'Size', type: 'select', options: ['Single', 'Double', 'Queen', 'King'] },
      { name: 'Material', type: 'select', options: ['Wood', 'Metal', 'Upholstered', 'Hydraulic'] },
      { name: 'Storage', type: 'boolean' },
    ],
  },
  {
    name: 'Tables',
    slug: 'tables',
    attributes: [
      { name: 'Type', type: 'select', options: ['Dining', 'Coffee', 'Study', 'Console'] },
      { name: 'Material', type: 'select', options: ['Wood', 'Glass', 'Metal', 'Marble'] },
      { name: 'Shape', type: 'select', options: ['Rectangle', 'Round', 'Square', 'Oval'] },
    ],
  },
  {
    name: 'Chairs',
    slug: 'chairs',
    attributes: [
      { name: 'Type', type: 'select', options: ['Dining', 'Office', 'Accent', 'Rocking'] },
      { name: 'Material', type: 'select', options: ['Wood', 'Metal', 'Plastic', 'Upholstered'] },
      { name: 'Armrest', type: 'boolean' },
    ],
  },
  {
    name: 'Wardrobes',
    slug: 'wardrobes',
    attributes: [
      { name: 'Type', type: 'select', options: ['2 Door', '3 Door', '4 Door', 'Walk-in'] },
      { name: 'Material', type: 'select', options: ['Wood', 'Engineered Wood', 'Metal'] },
      { name: 'Mirror', type: 'boolean' },
    ],
  },
  {
    name: 'Refrigerators',
    slug: 'refrigerators',
    attributes: [
      { name: 'Capacity', type: 'select', options: ['165L', '190L', '240L', '320L', '450L+'] },
      { name: 'Type', type: 'select', options: ['Single Door', 'Double Door', 'Side-by-Side', 'French Door'] },
      { name: 'Energy Rating', type: 'select', options: ['1 Star', '2 Star', '3 Star', '4 Star', '5 Star'] },
    ],
  },
  {
    name: 'Washing Machines',
    slug: 'washing-machines',
    attributes: [
      { name: 'Type', type: 'select', options: ['Front Load', 'Top Load', 'Semi-Automatic'] },
      { name: 'Capacity', type: 'select', options: ['6kg', '7kg', '8kg', '9kg', '10kg+'] },
      { name: 'Dryer', type: 'boolean' },
    ],
  },
  {
    name: 'Televisions',
    slug: 'televisions',
    attributes: [
      { name: 'Screen Size', type: 'select', options: ['32"', '40"', '43"', '50"', '55"', '65"+'] },
      { name: 'Type', type: 'select', options: ['LED', 'OLED', 'QLED', 'Smart TV'] },
      { name: 'Resolution', type: 'select', options: ['HD', 'Full HD', '4K', '8K'] },
    ],
  },
  {
    name: 'Air Conditioners',
    slug: 'air-conditioners',
    attributes: [
      { name: 'Type', type: 'select', options: ['Window', 'Split', 'Portable', 'Cassette'] },
      { name: 'Capacity', type: 'select', options: ['1 Ton', '1.5 Ton', '2 Ton', '2.5 Ton+'] },
      { name: 'Energy Rating', type: 'select', options: ['1 Star', '2 Star', '3 Star', '4 Star', '5 Star'] },
    ],
  },
];

// Generate random Indian name
const generateIndianName = () => {
  const firstNames = ['Aarav', 'Vihaan', 'Vivaan', 'Ananya', 'Diya', 'Advik', 'Kabir', 'Aaradhya', 'Reyansh', 'Sai', 'Arjun', 'Ishaan', 'Ayaan', 'Pari', 'Anaya', 'Saanvi', 'Krishna', 'Laksh', 'Rudra', 'Samaira'];
  const lastNames = ['Sharma', 'Verma', 'Patel', 'Kumar', 'Singh', 'Reddy', 'Gupta', 'Joshi', 'Desai', 'Mehta', 'Shah', 'Malhotra', 'Choudhary', 'Thakur', 'Yadav', 'Rao', 'Nair', 'Menon', 'Pillai', 'Iyer'];
  
  return {
    firstName: faker.helpers.arrayElement(firstNames),
    lastName: faker.helpers.arrayElement(lastNames),
  };
};

// Generate random phone number
const generateIndianPhone = () => {
  const prefixes = ['6', '7', '8', '9'];
  return prefixes[Math.floor(Math.random() * prefixes.length)] + 
         Math.floor(100000000 + Math.random() * 900000000).toString().slice(0, 9);
};

// Generate random Aadhar number
const generateAadhar = () => {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
};

// Generate random PAN
const generatePAN = () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let pan = '';
  for (let i = 0; i < 5; i++) pan += letters[Math.floor(Math.random() * 26)];
  pan += Math.floor(1000 + Math.random() * 9000);
  pan += letters[Math.floor(Math.random() * 26)];
  return pan;
};

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(config.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.log(chalk.green('✓ Connected to MongoDB'));
  } catch (error) {
    logger.error(chalk.red('✗ MongoDB connection error:'), error);
    process.exit(1);
  }
};

// Clear database
const clearDatabase = async () => {
  if (!config.clear) return;

  logger.log(chalk.yellow('\n🗑️  Clearing existing data...'));

  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
    logger.log(chalk.gray(`  - Cleared ${key}`));
  }
};

// Create categories
const createCategories = async () => {
  logger.log(chalk.cyan('\n📁 Creating categories...'));
  const bar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: PRODUCT_CATEGORIES.length,
    width: 40,
  });

  const categories = [];
  for (const catData of PRODUCT_CATEGORIES) {
    const category = await Category.create({
      name: catData.name,
      slug: catData.slug,
      description: faker.lorem.paragraph(),
      attributes: catData.attributes,
      image: {
        url: faker.image.urlLoremFlickr({ category: catData.slug }),
        thumbnail: faker.image.urlLoremFlickr({ category: catData.slug, width: 100, height: 100 }),
      },
      isActive: true,
      displayOrder: categories.length,
    });
    categories.push(category);
    bar.tick();
  }

  logger.log(chalk.green(`  ✓ Created ${categories.length} categories`));
  return categories;
};

// Create users (regular, vendors, admins)
const createUsers = async (categories) => {
  logger.log(chalk.cyan('\n👥 Creating users...'));
  
  const users = [];
  const vendors = [];
  const admins = [];

  // Create admin users
  logger.log(chalk.cyan('  Creating admins...'));
  const adminBar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: config.counts.admins,
    width: 40,
  });

  const adminRoles = ['super_admin', 'admin', 'operations_manager'];
  for (let i = 0; i < config.counts.admins; i++) {
    const name = generateIndianName();
    const email = `admin${i+1}@rentease.com`;
    const phone = generateIndianPhone();

    const user = await User.create({
      email,
      phone,
      password: await bcrypt.hash('Admin@123', 10),
      profile: {
        firstName: name.firstName,
        lastName: name.lastName,
        avatar: faker.image.avatar(),
      },
      role: 'admin',
      verification: {
        email: true,
        phone: true,
        kyc: {
          status: 'approved',
          aadharNumber: generateAadhar(),
          panNumber: generatePAN(),
          verifiedAt: new Date(),
        },
      },
      status: {
        isActive: true,
        isBlocked: false,
      },
    });

    const admin = await Admin.create({
      user: user._id,
      email: user.email,
      profile: {
        firstName: user.profile.firstName,
        lastName: user.profile.lastName,
        department: faker.helpers.arrayElement(['super_admin', 'operations', 'customer_support']),
        employeeId: `EMP${String(i+1).padStart(4, '0')}`,
      },
      role: adminRoles[i % adminRoles.length],
      permissions: {},
      status: {
        isActive: true,
      },
    });

    users.push(user);
    admins.push(admin);
    adminBar.tick();
  }

  // Create vendor users
  logger.log(chalk.cyan('  Creating vendors...'));
  const vendorBar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: config.counts.vendors,
    width: 40,
  });

  for (let i = 0; i < config.counts.vendors; i++) {
    const name = generateIndianName();
    const email = faker.internet.email({ firstName: name.firstName, lastName: name.lastName }).toLowerCase();
    const phone = generateIndianPhone();
    const city = faker.helpers.arrayElement(INDIAN_CITIES);

    const user = await User.create({
      email,
      phone,
      password: await bcrypt.hash('Vendor@123', 10),
      profile: {
        firstName: name.firstName,
        lastName: name.lastName,
        avatar: faker.image.avatar(),
      },
      role: 'vendor',
      verification: {
        email: true,
        phone: true,
        kyc: {
          status: faker.helpers.arrayElement(['pending', 'approved', 'approved', 'approved']),
          aadharNumber: generateAadhar(),
          panNumber: generatePAN(),
          verifiedAt: faker.date.recent(),
        },
      },
      status: {
        isActive: true,
      },
    });

    const vendor = await Vendor.create({
      user: user._id,
      vendorId: `VEN${String(i+1).padStart(4, '0')}`,
      business: {
        name: `${name.lastName} Enterprises`,
        gstin: `27${generatePAN()}1Z5`,
        panNumber: generatePAN(),
        description: faker.company.catchPhrase(),
        foundedYear: faker.number.int({ min: 2010, max: 2023 }),
      },
      contact: {
        primaryPhone: phone,
        primaryEmail: email,
        supportPhone: generateIndianPhone(),
        supportEmail: `support@${name.lastName.toLowerCase()}.com`,
      },
      addresses: {
        serviceableCities: [city.city],
        serviceablePincodes: [city.pincode],
      },
      verification: {
        status: 'verified',
        verifiedAt: new Date(),
      },
      commission: {
        rate: faker.number.int({ min: 5, max: 15 }),
        type: 'percentage',
      },
      subscription: {
        plan: faker.helpers.arrayElement(['basic', 'standard', 'premium']),
        validUntil: faker.date.future(),
      },
      performance: {
        rating: {
          average: faker.number.float({ min: 3.5, max: 5, precision: 0.1 }),
          count: faker.number.int({ min: 10, max: 100 }),
        },
      },
      status: {
        isActive: true,
        isOnboarded: true,
        onboardedAt: faker.date.past(),
      },
    });

    users.push(user);
    vendors.push(vendor);
    vendorBar.tick();
  }

  // Create regular users
  logger.log(chalk.cyan('  Creating regular users...'));
  const userBar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: config.counts.users - config.counts.vendors - config.counts.admins,
    width: 40,
  });

  const remainingUsers = config.counts.users - config.counts.vendors - config.counts.admins;
  for (let i = 0; i < remainingUsers; i++) {
    const name = generateIndianName();
    const email = faker.internet.email({ firstName: name.firstName, lastName: name.lastName }).toLowerCase();
    const phone = generateIndianPhone();

    const user = await User.create({
      email,
      phone,
      password: await bcrypt.hash('User@123', 10),
      profile: {
        firstName: name.firstName,
        lastName: name.lastName,
        avatar: faker.image.avatar(),
        dateOfBirth: faker.date.birthdate({ min: 18, max: 65, mode: 'age' }),
      },
      role: 'user',
      verification: {
        email: faker.datatype.boolean(0.8),
        phone: faker.datatype.boolean(0.8),
        kyc: {
          status: faker.helpers.arrayElement(['pending', 'approved', 'approved', 'rejected']),
        },
      },
      stats: {
        memberSince: faker.date.past(),
      },
      status: {
        isActive: true,
      },
    });

    users.push(user);
    userBar.tick();
  }

  logger.log(chalk.green(`  ✓ Created ${users.length} users (${vendors.length} vendors, ${admins.length} admins)`));
  return { users, vendors, admins };
};

// Create addresses for users
const createAddresses = async (users) => {
  logger.log(chalk.cyan('\n📍 Creating addresses...'));
  const bar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: users.length,
    width: 40,
  });

  const addresses = [];
  for (const user of users) {
    // Each user has 1-3 addresses
    const numAddresses = faker.number.int({ min: 1, max: 3 });
    for (let j = 0; j < numAddresses; j++) {
      const city = faker.helpers.arrayElement(INDIAN_CITIES);
      const address = await Address.create({
        user: user._id,
        addressType: faker.helpers.arrayElement(['home', 'work', 'other']),
        addressLine1: faker.location.streetAddress(),
        addressLine2: faker.datatype.boolean() ? faker.location.secondaryAddress() : undefined,
        area: faker.location.street(),
        city: city.city,
        state: city.state,
        pincode: city.pincode,
        country: 'India',
        contactDetails: {
          name: `${user.profile.firstName} ${user.profile.lastName}`,
          phone: user.phone,
        },
        isDefault: j === 0,
        coordinates: {
          type: 'Point',
          coordinates: [
            faker.location.longitude({ min: 68, max: 97 }),
            faker.location.latitude({ min: 8, max: 37 }),
          ],
        },
      });
      addresses.push(address);
    }
    bar.tick();
  }

  logger.log(chalk.green(`  ✓ Created ${addresses.length} addresses`));
  return addresses;
};

// Create products
const createProducts = async (vendors, categories) => {
  logger.log(chalk.cyan('\n📦 Creating products...'));
  const bar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: config.counts.products,
    width: 40,
  });

  const products = [];
  for (let i = 0; i < config.counts.products; i++) {
    const vendor = faker.helpers.arrayElement(vendors);
    const category = faker.helpers.arrayElement(categories);
    const name = `${faker.commerce.productAdjective()} ${category.name} ${faker.string.alphanumeric(4)}`;
    
    // Generate specifications based on category
    const specifications = {};
    if (category.attributes) {
      category.attributes.forEach(attr => {
        if (attr.type === 'select') {
          specifications[attr.name] = faker.helpers.arrayElement(attr.options);
        } else if (attr.type === 'boolean') {
          specifications[attr.name] = faker.datatype.boolean();
        }
      });
    }

    const monthlyRent = faker.number.int({ min: 499, max: 9999 });
    const securityDeposit = monthlyRent * 2;
    
    const product = await Product.create({
      vendor: vendor.user,
      category: category._id,
      basicInfo: {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: faker.commerce.productDescription(),
        brand: faker.helpers.arrayElement(['Godrej', 'Nilkamal', 'Durian', 'Wakefit', 'Pepperfry', 'IKEA', 'Samsung', 'LG', 'Whirlpool']),
        sku: `SKU${String(i+1).padStart(6, '0')}`,
      },
      pricing: {
        monthlyRent,
        securityDeposit,
        deliveryCharges: faker.number.int({ min: 0, max: 500 }),
        rentalOptions: [
          { months: 3, discount: 0, monthlyPrice: monthlyRent, totalPrice: monthlyRent * 3 },
          { months: 6, discount: 5, monthlyPrice: monthlyRent * 0.95, totalPrice: monthlyRent * 6 * 0.95 },
          { months: 12, discount: 10, monthlyPrice: monthlyRent * 0.9, totalPrice: monthlyRent * 12 * 0.9 },
        ],
        lateFeePerDay: Math.round(monthlyRent / 30),
      },
      inventory: {
        totalQuantity: faker.number.int({ min: 5, max: 50 }),
        availableQuantity: faker.number.int({ min: 1, max: 20 }),
      },
      specifications,
      condition: faker.helpers.arrayElement(['new', 'like-new', 'good']),
      dimensions: {
        length: faker.number.int({ min: 50, max: 200 }),
        width: faker.number.int({ min: 30, max: 150 }),
        height: faker.number.int({ min: 20, max: 180 }),
        weight: faker.number.int({ min: 5, max: 50 }),
      },
      media: {
        images: [
          {
            url: faker.image.urlLoremFlickr({ category: category.slug }),
            thumbnail: faker.image.urlLoremFlickr({ category: category.slug, width: 100, height: 100 }),
            isPrimary: true,
          },
          {
            url: faker.image.urlLoremFlickr({ category: category.slug }),
            thumbnail: faker.image.urlLoremFlickr({ category: category.slug, width: 100, height: 100 }),
            isPrimary: false,
          },
        ],
      },
      rentalTerms: {
        minRentalMonths: 3,
        maxRentalMonths: 12,
        deliveryAvailable: true,
        pickupAvailable: true,
        serviceablePincodes: vendor.addresses?.serviceablePincodes || ['400001', '110001'],
      },
      tags: [category.name.toLowerCase(), ...faker.helpers.arrayElements(['new', 'popular', 'trending', 'discount'], 2)],
      status: {
        isActive: true,
        isVerified: true,
        approvalStatus: 'approved',
        approvedAt: faker.date.recent(),
      },
    });

    products.push(product);
    bar.tick();
  }

  logger.log(chalk.green(`  ✓ Created ${products.length} products`));
  return products;
};

// Create inventory items for products
const createInventory = async (products) => {
  logger.log(chalk.cyan('\n📊 Creating inventory items...'));
  
  const inventoryItems = [];
  let totalItems = 0;
  
  for (const product of products) {
    const quantity = product.inventory.totalQuantity;
    for (let i = 0; i < quantity; i++) {
      const inventory = await Inventory.create({
        product: product._id,
        sku: `${product.basicInfo.sku}-${String(i+1).padStart(3, '0')}`,
        serialNumber: faker.string.alphanumeric(12).toUpperCase(),
        qrCode: faker.string.alphanumeric(20),
        location: {
          warehouse: faker.helpers.arrayElement(['A', 'B', 'C']) + faker.number.int({ min: 1, max: 10 }),
          shelf: faker.helpers.arrayElement(['S1', 'S2', 'S3', 'S4']),
          city: faker.helpers.arrayElement(INDIAN_CITIES).city,
        },
        condition: {
          status: faker.helpers.arrayElement(['new', 'excellent', 'good']),
          lastInspectionDate: faker.date.recent(),
        },
        status: i < product.inventory.availableQuantity ? 'available' : 'available',
        purchaseInfo: {
          date: faker.date.past(),
          price: product.pricing.monthlyRent * 12,
          invoiceNumber: `INV-${faker.string.alphanumeric(8)}`,
          warrantyExpiry: faker.date.future(),
        },
      });
      inventoryItems.push(inventory);
      totalItems++;
    }
  }

  logger.log(chalk.green(`  ✓ Created ${totalItems} inventory items`));
  return inventoryItems;
};

// Create rentals
const createRentals = async (users, vendors, products, inventoryItems, addresses) => {
  logger.log(chalk.cyan('\n📋 Creating rentals...'));
  const bar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: config.counts.rentals,
    width: 40,
  });

  const rentals = [];
  const regularUsers = users.filter(u => u.role === 'user');

  for (let i = 0; i < config.counts.rentals; i++) {
    const user = faker.helpers.arrayElement(regularUsers);
    const product = faker.helpers.arrayElement(products);
    const vendor = vendors.find(v => v.user.toString() === product.vendor.toString());
    const address = await Address.findOne({ user: user._id });
    const inventory = await Inventory.findOne({ 
      product: product._id,
      status: 'available',
    });

    if (!inventory) continue;

    const startDate = faker.date.recent({ days: 90 });
    const tenureMonths = faker.helpers.arrayElement([3, 6, 12]);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + tenureMonths);

    const monthlyRent = product.pricing.monthlyRent;
    const securityDeposit = product.pricing.securityDeposit;
    const deliveryCharges = product.pricing.deliveryCharges;
    const subtotal = monthlyRent * tenureMonths;
    const totalAmount = subtotal + securityDeposit + deliveryCharges;

    const status = faker.helpers.arrayElement([
      'pending', 'confirmed', 'active', 'completed', 'cancelled',
    ]);

    const rental = await Rental.create({
      rentalNumber: `RNT${Date.now().toString().slice(-8)}${String(i).padStart(4, '0')}`,
      user: user._id,
      vendor: vendor.user,
      product: product._id,
      inventory: inventory._id,
      address: address._id,
      rentalDetails: {
        startDate,
        endDate,
        tenureMonths,
        monthlyRent,
        securityDeposit,
        deliveryCharges,
        subtotal,
        totalAmount,
      },
      payment: {
        status: faker.helpers.arrayElement(['pending', 'partial', 'completed']),
        paidAmount: faker.datatype.boolean() ? totalAmount : 0,
        dueAmount: totalAmount,
      },
      status,
      timeline: [{
        status: 'created',
        timestamp: startDate,
        note: 'Rental created',
      }],
    });

    // Update inventory status
    if (status === 'active' || status === 'confirmed') {
      inventory.status = 'rented';
      inventory.currentRental = rental._id;
      await inventory.save();
    }

    rentals.push(rental);
    bar.tick();
  }

  logger.log(chalk.green(`  ✓ Created ${rentals.length} rentals`));
  return rentals;
};

// Create payments for rentals
const createPayments = async (rentals) => {
  logger.log(chalk.cyan('\n💰 Creating payments...'));
  const bar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: rentals.length,
    width: 40,
  });

  const payments = [];
  for (const rental of rentals) {
    // Create security deposit payment
    const depositPayment = await Payment.create({
      paymentNumber: `PAY${Date.now().toString().slice(-8)}${String(payments.length).padStart(4, '0')}`,
      user: rental.user,
      rental: rental._id,
      amount: rental.rentalDetails.securityDeposit,
      type: 'security_deposit',
      method: faker.helpers.arrayElement(['upi', 'credit_card', 'net_banking']),
      status: faker.helpers.arrayElement(['success', 'success', 'success', 'pending']),
      timestamps: {
        initiated: rental.createdAt,
        completed: faker.date.between({ from: rental.createdAt, to: new Date() }),
      },
    });
    payments.push(depositPayment);

    // Create rent payment if rental is active
    if (rental.status === 'active' || rental.status === 'completed') {
      const rentPayment = await Payment.create({
        paymentNumber: `PAY${Date.now().toString().slice(-8)}${String(payments.length).padStart(4, '0')}`,
        user: rental.user,
        rental: rental._id,
        amount: rental.rentalDetails.subtotal,
        type: 'rent',
        method: faker.helpers.arrayElement(['upi', 'credit_card', 'net_banking']),
        status: 'success',
        timestamps: {
          initiated: rental.createdAt,
          completed: faker.date.between({ from: rental.createdAt, to: new Date() }),
        },
      });
      payments.push(rentPayment);

      // Update rental payment history
      rental.payment.paidAmount += rentPayment.amount;
      rental.payment.paymentHistory.push(rentPayment._id);
      await rental.save();
    }

    bar.tick();
  }

  logger.log(chalk.green(`  ✓ Created ${payments.length} payments`));
  return payments;
};

// Create reviews
const createReviews = async (rentals, users, products) => {
  logger.log(chalk.cyan('\n⭐ Creating reviews...'));
  const bar = new ProgressBar('  [:bar] :current/:total :percent', {
    total: config.counts.reviews,
    width: 40,
  });

  const reviews = [];
  const completedRentals = rentals.filter(r => r.status === 'completed');

  for (let i = 0; i < config.counts.reviews && i < completedRentals.length; i++) {
    const rental = completedRentals[i];
    const rating = faker.number.int({ min: 3, max: 5 });

    const review = await Review.create({
      reviewNumber: `REV${Date.now().toString().slice(-8)}${String(i).padStart(4, '0')}`,
      rental: rental._id,
      user: rental.user,
      product: rental.product,
      vendor: rental.vendor,
      ratings: {
        overall: rating,
        product: {
          quality: faker.number.int({ min: 3, max: 5 }),
          condition: faker.number.int({ min: 3, max: 5 }),
          valueForMoney: faker.number.int({ min: 3, max: 5 }),
        },
        vendor: {
          communication: faker.number.int({ min: 3, max: 5 }),
          deliveryTimeliness: faker.number.int({ min: 3, max: 5 }),
          professionalism: faker.number.int({ min: 3, max: 5 }),
        },
      },
      title: faker.lorem.sentence(),
      content: faker.lorem.paragraph(),
      pros: faker.helpers.arrayElements(['Good quality', 'Fast delivery', 'Clean product'], 2),
      cons: rating === 5 ? [] : faker.helpers.arrayElements(['Slight delay', 'Could be better'], 1),
      attachments: faker.datatype.boolean(0.3) ? [{
        type: 'image',
        url: faker.image.url(),
      }] : [],
      verification: {
        isVerifiedPurchase: true,
      },
      moderation: {
        status: 'approved',
        reviewedAt: new Date(),
      },
      helpful: {
        count: faker.number.int({ min: 0, max: 20 }),
      },
      status: 'active',
    });

    reviews.push(review);
    bar.tick();

    // Update product rating
    await Product.findByIdAndUpdate(rental.product, {
      $inc: { 'ratings.count': 1 },
      $set: { 'ratings.average': await Review.getAverageRating(rental.product) },
    });
  }

  logger.log(chalk.green(`  ✓ Created ${reviews.length} reviews`));
  return reviews;
};

// Create discounts
const createDiscounts = async () => {
  logger.log(chalk.cyan('\n🏷️  Creating discounts...'));

  const discounts = await Discount.create([
    {
      code: 'WELCOME20',
      name: 'Welcome Discount',
      description: '20% off on first rental',
      type: 'percentage',
      value: 20,
      maxDiscountAmount: 2000,
      minOrderValue: 1000,
      applicableOn: {
        type: 'first_rental',
      },
      userEligibility: {
        userType: 'new',
      },
      usageLimits: {
        perUser: 1,
        global: 1000,
      },
      validity: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
      status: 'active',
    },
    {
      code: 'SUMMER10',
      name: 'Summer Special',
      description: '10% off on all AC rentals',
      type: 'percentage',
      value: 10,
      maxDiscountAmount: 1500,
      minOrderValue: 2000,
      applicableOn: {
        type: 'category',
        categoryIds: [], // Will be populated later
      },
      validity: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      status: 'active',
    },
    {
      code: 'FREEDEL',
      name: 'Free Delivery',
      description: 'Free delivery on rentals above ₹5000',
      type: 'free_delivery',
      minOrderValue: 5000,
      validity: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
      status: 'active',
    },
    {
      code: 'NODEPOSIT',
      name: 'Zero Deposit',
      description: 'No security deposit on selected items',
      type: 'no_deposit',
      applicableOn: {
        type: 'product',
        productIds: [],
      },
      validity: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      },
      status: 'active',
    },
    {
      code: 'FLAT500',
      name: 'Flat ₹500 Off',
      description: 'Flat ₹500 off on rentals above ₹3000',
      type: 'fixed',
      value: 500,
      minOrderValue: 3000,
      validity: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      },
      status: 'active',
    },
  ]);

  logger.log(chalk.green(`  ✓ Created ${discounts.length} discounts`));
  return discounts;
};

// Main seeding function
const seedDatabase = async () => {
  try {
    logger.log(chalk.blue('\n🌱 Starting database seeding...'));
    logger.log(chalk.gray(`Environment: ${options.env}`));
    logger.log(chalk.gray(`Clear existing: ${config.clear}`));
    
    await connectDB();
    await clearDatabase();

    // Create categories first
    const categories = await createCategories();

    // Create users (including vendors and admins)
    const { users, vendors, admins } = await createUsers(categories);

    // Create addresses
    const addresses = await createAddresses(users);

    // Create products
    const products = await createProducts(vendors, categories);

    // Create inventory
    const inventory = await createInventory(products);

    // Create rentals
    const rentals = await createRentals(users, vendors, products, inventory, addresses);

    // Create payments
    const payments = await createPayments(rentals);

    // Create reviews
    const reviews = await createReviews(rentals, users, products);

    // Create discounts
    const discounts = await createDiscounts();

    // Summary
    logger.log(chalk.green('\n✅ Database seeding completed successfully!'));
    logger.log(chalk.blue('\n📊 Summary:'));
    logger.log(chalk.white(`  Users: ${users.length}`));
    logger.log(chalk.white(`  Vendors: ${vendors.length}`));
    logger.log(chalk.white(`  Admins: ${admins.length}`));
    logger.log(chalk.white(`  Categories: ${categories.length}`));
    logger.log(chalk.white(`  Products: ${products.length}`));
    logger.log(chalk.white(`  Inventory Items: ${inventory.length}`));
    logger.log(chalk.white(`  Addresses: ${addresses.length}`));
    logger.log(chalk.white(`  Rentals: ${rentals.length}`));
    logger.log(chalk.white(`  Payments: ${payments.length}`));
    logger.log(chalk.white(`  Reviews: ${reviews.length}`));
    logger.log(chalk.white(`  Discounts: ${discounts.length}`));

    logger.log(chalk.blue('\n🔑 Default Login Credentials:'));
    logger.log(chalk.white(`  Admin: admin1@rentease.com / Admin@123`));
    logger.log(chalk.white(`  Vendor: ${vendors[0]?.user?.email || 'vendor@rentease.com'} / Vendor@123`));
    logger.log(chalk.white(`  User: ${users.find(u => u.role === 'user')?.email || 'user@rentease.com'} / User@123`));

    process.exit(0);
  } catch (error) {
    logger.error(chalk.red('\n❌ Seeding failed:'), error);
    process.exit(1);
  }
};

// Run seeding
seedDatabase();