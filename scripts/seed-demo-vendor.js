#!/usr/bin/env node

/**
 * Seed a single deterministic DEMO VENDOR for local login/testing.
 *
 * Usage: npm run seed:demo-vendor
 *
 * Non-destructive: upserts one user by email, touches no other data.
 * Credentials created:
 *   email:    vendor@rentease.com
 *   password: Vendor@123
 *
 * Password is hashed with bcryptjs to match utils/encryption.js (the hash the
 * login flow compares against). The User model's pre-save hashing hook is
 * disabled, so we set the already-hashed value directly.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { User, Vendor } = require('../src/models');

const DEMO = {
  email: 'vendor@rentease.com',
  phone: '9000000001',
  password: 'Vendor@123',
  firstName: 'Demo',
  lastName: 'Vendor',
};

async function run() {
  const uri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/rentease';

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const hashedPassword = await bcrypt.hash(DEMO.password, 10);

  const update = {
    email: DEMO.email,
    phone: DEMO.phone,
    password: hashedPassword,
    role: 'vendor',
    profile: { firstName: DEMO.firstName, lastName: DEMO.lastName },
    verification: { email: true, phone: true },
    status: { isActive: true, isBlocked: false },
  };

  const user = await User.findOneAndUpdate(
    { email: DEMO.email },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Ensure a Vendor business document exists (required to list products).
  let vendor = await Vendor.findOne({ user: user._id });
  if (!vendor) {
    vendor = await Vendor.create({
      user: user._id,
      vendorId: `VEN${String(Date.now()).slice(-8)}`,
      business: { name: 'Demo Vendor Enterprises', description: 'Demo vendor for local testing' },
      contact: { primaryPhone: DEMO.phone, primaryEmail: DEMO.email },
      verification: { status: 'verified', verifiedAt: new Date() },
      status: { isActive: true, isOnboarded: true, onboardedAt: new Date() },
    });
  }

  console.log('✅ Demo vendor ready:');
  console.log(`   userId:   ${user._id}`);
  console.log(`   vendorId: ${vendor._id} (${vendor.vendorId})`);
  console.log(`   email:    ${DEMO.email}`);
  console.log(`   password: ${DEMO.password}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('❌ Failed to seed demo vendor:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
