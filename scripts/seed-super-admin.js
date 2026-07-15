const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Admin, User } = require('../src/models');
const config = require('../src/config/env');
const logger = require('../src/config/logger');

const seedSuperAdmin = async () => {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('Connected to MongoDB ss');

    // Check if super admin already exists
    const existingSuperAdmin = await Admin.findOne({ role: 'super_admin' });
    
    if (existingSuperAdmin) {
      logger.info('Super admin already exists!');
      console.log('\n📋 Existing Super Admin Details:');
      console.log(`   Email: ${existingSuperAdmin.email}`);
      console.log(`   Name: ${existingSuperAdmin.profile.firstName} ${existingSuperAdmin.profile.lastName}`);
      console.log(`   Employee ID: ${existingSuperAdmin.profile.employeeId}`);
      
      await mongoose.disconnect();
      process.exit(0);
    }

    // Super admin credentials (change these!)
    const superAdminData = {
      email: 'souravbhukta8@gmail.com',
      phone: '7908104094',
      password: 'Sourav1234@',
      profile: {
        firstName: 'Sourav',
        lastName: 'Administrator',
        department: 'super_admin',
        designation: 'Chief Administrator',
        employeeId: 'SA0001',
        joiningDate: new Date()
      },
      role: 'super_admin',
      permissions: {
        users: {
          view: true,
          create: true,
          edit: true,
          delete: true,
          block: true,
          verifyKyc: true
        },
        vendors: {
          view: true,
          approve: true,
          suspend: true,
          manageCommission: true,
          viewPayouts: true
        },
        products: {
          view: true,
          create: true,
          edit: true,
          delete: true,
          approve: true,
          feature: true
        },
        rentals: {
          view: true,
          manage: true,
          cancel: true,
          refund: true,
          disputeResolution: true
        },
        payments: {
          view: true,
          process: true,
          refund: true,
          adjust: true,
          viewPayouts: true
        },
        inventory: {
          view: true,
          manage: true,
          transfer: true,
          writeoff: true
        },
        maintenance: {
          view: true,
          assign: true,
          approveCharges: true
        },
        discounts: {
          view: true,
          create: true,
          edit: true,
          delete: true
        },
        content: {
          manageCategories: true,
          manageBlog: true,
          manageFaqs: true,
          managePages: true
        },
        analytics: {
          view: true,
          export: true,
          manageReports: true
        },
        admins: {
          view: true,
          create: true,
          edit: true,
          delete: true,
          manageRoles: true
        },
        system: {
          manageSettings: true,
          viewLogs: true,
          manageBackup: true,
          manageMaintenance: true
        }
      },
      access: {
        twoFactorEnabled: false,
        sessionTimeout: 60,
        maxSessions: 5,
        requirePasswordChange: false,
        passwordLastChanged: new Date()
      },
      status: {
        isActive: true,
        isBlocked: false
      },
      security: {
        emailVerified: true,
        phoneVerified: true,
        failedLoginAttempts: 0
      }
    };

    // Hash password
    const hashedPassword = await bcrypt.hash(superAdminData.password, 12);
    superAdminData.password = hashedPassword;

    // Create admin directly
    const admin = await Admin.create(superAdminData);
    logger.info('Super Admin created successfully!');

    // Create linked user record
    const user = await User.create({
      email: superAdminData.email,
      phone: superAdminData.phone,
      password: hashedPassword,
      profile: {
        firstName: superAdminData.profile.firstName,
        lastName: superAdminData.profile.lastName
      },
      role: 'super-admin',
      verification: {
        email: true,
        phone: true
      },
      status: {
        isActive: true,
        isBlocked: false
      }
    });

    // Link admin to user
    admin.user = user._id;
    await admin.save();

    console.log('\n✅ Super Admin Created Successfully!');
    console.log('\n📋 Login Credentials:');
    console.log(`   Email: ${superAdminData.email}`);
    console.log(`   Phone: ${superAdminData.phone}`);
    console.log(`   Password: Admin@123`);
    console.log('\n⚠️  Please change the password after first login!');
    console.log('\n🔗 Admin Portal: http://localhost:3000/admin/login');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding super admin:', error);
    process.exit(1);
  }
};

seedSuperAdmin();