#!/usr/bin/env node

/**
 * Report Generation Script
 * Usage: npm run generate-report
 * Options:
 *   --type=rentals - report type (rentals, users, revenue, products, vendors, maintenance)
 *   --format=csv - output format (csv, excel, json, pdf)
 *   --start=2024-01-01 - start date
 *   --end=2024-12-31 - end date
 *   --output=./reports - output directory
 */

const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const moment = require('moment');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const commandLineArgs = require('command-line-args');
const { Parser } = require('json2csv');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const {
  User,
  Vendor,
  Product,
  Rental,
  Payment,
  Maintenance,
  Review,
} = require('../src/models');

const logger = console;

// Command line options
const options = commandLineArgs([
  { name: 'type', type: String, defaultValue: 'rentals' },
  { name: 'format', type: String, defaultValue: 'csv' },
  { name: 'start', type: String },
  { name: 'end', type: String },
  { name: 'output', type: String, defaultValue: './reports' },
  { name: 'help', type: Boolean, defaultValue: false },
]);

if (options.help) {
  console.log(`
  Usage: node scripts/generateReports.js [options]

  Options:
    --type=rentals     Report type: rentals, users, revenue, products, vendors, maintenance
    --format=csv       Output format: csv, excel, json, pdf
    --start=2024-01-01 Start date
    --end=2024-12-31   End date
    --output=./reports Output directory
    --help            Show this help message

  Examples:
    node scripts/generateReports.js --type=revenue --format=excel --start=2024-01-01 --end=2024-12-31
    node scripts/generateReports.js --type=users --format=csv
  `);
  process.exit(0);
}

// Configuration
const config = {
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/rentease',
  reportType: options.type,
  format: options.format,
  startDate: options.start ? moment(options.start).startOf('day').toDate() : moment().subtract(30, 'days').toDate(),
  endDate: options.end ? moment(options.end).endOf('day').toDate() : moment().toDate(),
  outputDir: path.resolve(options.output),
};

// Ensure output directory exists
fs.ensureDirSync(config.outputDir);

// Report generators
const reportGenerators = {
  // Rental report
  rentals: async () => {
    logger.log(chalk.blue('📋 Generating rental report...'));

    const rentals = await Rental.find({
      createdAt: { $gte: config.startDate, $lte: config.endDate },
    })
      .populate('user', 'profile.firstName profile.lastName email phone')
      .populate('vendor', 'business.name')
      .populate('product', 'basicInfo.name')
      .lean();

    const data = rentals.map(r => ({
      'Rental Number': r.rentalNumber,
      'User Name': r.user?.profile?.firstName + ' ' + r.user?.profile?.lastName,
      'User Email': r.user?.email,
      'User Phone': r.user?.phone,
      'Vendor': r.vendor?.business?.name,
      'Product': r.product?.basicInfo?.name,
      'Start Date': moment(r.rentalDetails.startDate).format('DD/MM/YYYY'),
      'End Date': moment(r.rentalDetails.endDate).format('DD/MM/YYYY'),
      'Tenure (Months)': r.rentalDetails.tenureMonths,
      'Monthly Rent': r.rentalDetails.monthlyRent,
      'Security Deposit': r.rentalDetails.securityDeposit,
      'Total Amount': r.rentalDetails.totalAmount,
      'Paid Amount': r.payment?.paidAmount,
      'Status': r.status,
      'Created At': moment(r.createdAt).format('DD/MM/YYYY HH:mm'),
    }));

    return {
      title: 'Rental Report',
      filename: `rentals_${moment(config.startDate).format('YYYYMMDD')}_${moment(config.endDate).format('YYYYMMDD')}`,
      data,
      summary: {
        'Total Rentals': rentals.length,
        'Total Revenue': rentals.reduce((sum, r) => sum + r.rentalDetails.totalAmount, 0),
        'Average Rental Value': rentals.length ? 
          (rentals.reduce((sum, r) => sum + r.rentalDetails.totalAmount, 0) / rentals.length).toFixed(2) : 0,
        'Active Rentals': rentals.filter(r => r.status === 'active').length,
        'Completed Rentals': rentals.filter(r => r.status === 'completed').length,
        'Cancelled Rentals': rentals.filter(r => r.status === 'cancelled').length,
      },
    };
  },

  // User report
  users: async () => {
    logger.log(chalk.blue('👥 Generating user report...'));

    const users = await User.find({
      createdAt: { $gte: config.startDate, $lte: config.endDate },
    }).lean();

    const data = users.map(u => ({
      'User ID': u._id,
      'Name': u.profile?.firstName + ' ' + u.profile?.lastName,
      'Email': u.email,
      'Phone': u.phone,
      'Role': u.role,
      'Email Verified': u.verification?.email ? 'Yes' : 'No',
      'Phone Verified': u.verification?.phone ? 'Yes' : 'No',
      'KYC Status': u.verification?.kyc?.status,
      'Total Rentals': u.stats?.totalRentals || 0,
      'Total Spent': u.stats?.totalSpent || 0,
      'Status': u.status?.isActive ? 'Active' : 'Inactive',
      'Joined Date': moment(u.createdAt).format('DD/MM/YYYY'),
      'Last Active': u.stats?.lastActive ? moment(u.stats.lastActive).format('DD/MM/YYYY HH:mm') : 'Never',
    }));

    return {
      title: 'User Report',
      filename: `users_${moment(config.startDate).format('YYYYMMDD')}_${moment(config.endDate).format('YYYYMMDD')}`,
      data,
      summary: {
        'Total Users': users.length,
        'Active Users': users.filter(u => u.status?.isActive).length,
        'Verified Users': users.filter(u => u.verification?.email && u.verification?.phone).length,
        'KYC Approved': users.filter(u => u.verification?.kyc?.status === 'approved').length,
        'Vendors': users.filter(u => u.role === 'vendor').length,
        'Customers': users.filter(u => u.role === 'user').length,
      },
    };
  },

  // Revenue report
  revenue: async () => {
    logger.log(chalk.blue('💰 Generating revenue report...'));

    const payments = await Payment.find({
      createdAt: { $gte: config.startDate, $lte: config.endDate },
      status: 'success',
    })
      .populate('user', 'profile.firstName profile.lastName email')
      .populate('rental', 'rentalNumber')
      .lean();

    // Group by payment type
    const byType = payments.reduce((acc, p) => {
      acc[p.type] = (acc[p.type] || 0) + p.amount;
      return acc;
    }, {});

    // Group by payment method
    const byMethod = payments.reduce((acc, p) => {
      acc[p.method] = (acc[p.method] || 0) + p.amount;
      return acc;
    }, {});

    // Group by month
    const byMonth = payments.reduce((acc, p) => {
      const month = moment(p.createdAt).format('YYYY-MM');
      if (!acc[month]) {
        acc[month] = { count: 0, amount: 0 };
      }
      acc[month].count++;
      acc[month].amount += p.amount;
      return acc;
    }, {});

    const data = payments.map(p => ({
      'Payment ID': p.paymentNumber,
      'User': p.user?.profile?.firstName + ' ' + p.user?.profile?.lastName,
      'Rental': p.rental?.rentalNumber,
      'Amount': p.amount,
      'Type': p.type,
      'Method': p.method,
      'Status': p.status,
      'Date': moment(p.createdAt).format('DD/MM/YYYY HH:mm'),
    }));

    return {
      title: 'Revenue Report',
      filename: `revenue_${moment(config.startDate).format('YYYYMMDD')}_${moment(config.endDate).format('YYYYMMDD')}`,
      data,
      summary: {
        'Total Revenue': payments.reduce((sum, p) => sum + p.amount, 0),
        'Total Transactions': payments.length,
        'Average Transaction': payments.length ? 
          (payments.reduce((sum, p) => sum + p.amount, 0) / payments.length).toFixed(2) : 0,
        'By Type': byType,
        'By Method': byMethod,
        'By Month': byMonth,
      },
    };
  },

  // Product report
  products: async () => {
    logger.log(chalk.blue('📦 Generating product report...'));

    const products = await Product.find({
      createdAt: { $gte: config.startDate, $lte: config.endDate },
    })
      .populate('vendor', 'business.name')
      .populate('category', 'name')
      .lean();

    // Get rental counts for each product
    for (const product of products) {
      const rentalCount = await Rental.countDocuments({ product: product._id });
      product.rentalCount = rentalCount;
    }

    const data = products.map(p => ({
      'Product ID': p._id,
      'Name': p.basicInfo?.name,
      'Vendor': p.vendor?.business?.name,
      'Category': p.category?.name,
      'Monthly Rent': p.pricing?.monthlyRent,
      'Security Deposit': p.pricing?.securityDeposit,
      'Total Quantity': p.inventory?.totalQuantity,
      'Available Quantity': p.inventory?.availableQuantity,
      'Rented Count': p.rentalCount,
      'Condition': p.condition,
      'Rating': p.ratings?.average?.toFixed(1) || 'N/A',
      'Total Reviews': p.ratings?.count || 0,
      'Status': p.status?.isActive ? 'Active' : 'Inactive',
      'Created At': moment(p.createdAt).format('DD/MM/YYYY'),
    }));

    return {
      title: 'Product Report',
      filename: `products_${moment(config.startDate).format('YYYYMMDD')}_${moment(config.endDate).format('YYYYMMDD')}`,
      data,
      summary: {
        'Total Products': products.length,
        'Active Products': products.filter(p => p.status?.isActive).length,
        'Total Inventory': products.reduce((sum, p) => sum + (p.inventory?.totalQuantity || 0), 0),
        'Available Inventory': products.reduce((sum, p) => sum + (p.inventory?.availableQuantity || 0), 0),
        'Average Rating': (products.reduce((sum, p) => sum + (p.ratings?.average || 0), 0) / products.length).toFixed(1),
        'Top Categories': products.reduce((acc, p) => {
          const cat = p.category?.name || 'Uncategorized';
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  },

  // Vendor report
  vendors: async () => {
    logger.log(chalk.blue('🏢 Generating vendor report...'));

    const vendors = await Vendor.find({
      createdAt: { $gte: config.startDate, $lte: config.endDate },
    })
      .populate('user', 'email phone profile')
      .lean();

    for (const vendor of vendors) {
      const productCount = await Product.countDocuments({ vendor: vendor.user });
      const rentalCount = await Rental.countDocuments({ vendor: vendor.user });
      const revenue = await Rental.aggregate([
        { $match: { vendor: vendor.user, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$rentalDetails.totalAmount' } } },
      ]);
      
      vendor.productCount = productCount;
      vendor.rentalCount = rentalCount;
      vendor.totalRevenue = revenue[0]?.total || 0;
    }

    const data = vendors.map(v => ({
      'Vendor ID': v.vendorId,
      'Business Name': v.business?.name,
      'Owner Name': v.user?.profile?.firstName + ' ' + v.user?.profile?.lastName,
      'Email': v.user?.email,
      'Phone': v.user?.phone,
      'GSTIN': v.business?.gstin,
      'Verification Status': v.verification?.status,
      'Plan': v.subscription?.plan,
      'Products': v.productCount,
      'Total Rentals': v.rentalCount,
      'Total Revenue': v.totalRevenue,
      'Rating': v.performance?.rating?.average?.toFixed(1) || 'N/A',
      'Status': v.status?.isActive ? 'Active' : 'Inactive',
      'Joined Date': moment(v.createdAt).format('DD/MM/YYYY'),
    }));

    return {
      title: 'Vendor Report',
      filename: `vendors_${moment(config.startDate).format('YYYYMMDD')}_${moment(config.endDate).format('YYYYMMDD')}`,
      data,
      summary: {
        'Total Vendors': vendors.length,
        'Verified Vendors': vendors.filter(v => v.verification?.status === 'verified').length,
        'Active Vendors': vendors.filter(v => v.status?.isActive).length,
        'Total Products': vendors.reduce((sum, v) => sum + v.productCount, 0),
        'Total Rentals': vendors.reduce((sum, v) => sum + v.rentalCount, 0),
        'Total Revenue': vendors.reduce((sum, v) => sum + v.totalRevenue, 0),
        'By Plan': vendors.reduce((acc, v) => {
          acc[v.subscription?.plan] = (acc[v.subscription?.plan] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  },

  // Maintenance report
  maintenance: async () => {
    logger.log(chalk.blue('🔧 Generating maintenance report...'));

    const requests = await Maintenance.find({
      createdAt: { $gte: config.startDate, $lte: config.endDate },
    })
      .populate('user', 'profile.firstName profile.lastName email phone')
      .populate('vendor', 'business.name')
      .populate('product', 'basicInfo.name')
      .lean();

    // Calculate average resolution time
    const resolvedRequests = requests.filter(r => r.status === 'completed' && r.schedule?.actualEndDate);
    const avgResolutionTime = resolvedRequests.length ? 
      resolvedRequests.reduce((sum, r) => {
        const start = new Date(r.schedule?.actualStartDate || r.createdAt);
        const end = new Date(r.schedule?.actualEndDate);
        return sum + (end - start);
      }, 0) / resolvedRequests.length / (1000 * 60 * 60) : 0; // in hours

    const data = requests.map(r => ({
      'Request ID': r.requestNumber,
      'User': r.user?.profile?.firstName + ' ' + r.user?.profile?.lastName,
      'User Phone': r.user?.phone,
      'Vendor': r.vendor?.business?.name,
      'Product': r.product?.basicInfo?.name,
      'Issue Type': r.issueType,
      'Priority': r.priority,
      'Status': r.status,
      'Requested Date': moment(r.createdAt).format('DD/MM/YYYY HH:mm'),
      'Scheduled Date': r.schedule?.scheduledDate ? moment(r.schedule.scheduledDate).format('DD/MM/YYYY HH:mm') : 'N/A',
      'Completed Date': r.schedule?.actualEndDate ? moment(r.schedule.actualEndDate).format('DD/MM/YYYY HH:mm') : 'N/A',
      'Resolution Time (hrs)': r.schedule?.actualEndDate && r.createdAt ?
        ((new Date(r.schedule.actualEndDate) - new Date(r.createdAt)) / (1000 * 60 * 60)).toFixed(1) : 'N/A',
      'Cost': r.resolution?.cost?.total || 0,
      'Customer Rating': r.feedback?.rating || 'N/A',
    }));

    return {
      title: 'Maintenance Report',
      filename: `maintenance_${moment(config.startDate).format('YYYYMMDD')}_${moment(config.endDate).format('YYYYMMDD')}`,
      data,
      summary: {
        'Total Requests': requests.length,
        'Pending': requests.filter(r => r.status === 'pending').length,
        'In Progress': requests.filter(r => ['assigned', 'scheduled', 'in_progress'].includes(r.status)).length,
        'Completed': requests.filter(r => r.status === 'completed').length,
        'Cancelled': requests.filter(r => r.status === 'cancelled').length,
        'Avg Resolution Time (hrs)': avgResolutionTime.toFixed(1),
        'Total Cost': requests.reduce((sum, r) => sum + (r.resolution?.cost?.total || 0), 0),
        'By Priority': requests.reduce((acc, r) => {
          acc[r.priority] = (acc[r.priority] || 0) + 1;
          return acc;
        }, {}),
        'By Issue Type': requests.reduce((acc, r) => {
          acc[r.issueType] = (acc[r.issueType] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  },
};

// Output formatters
const formatters = {
  // CSV format
  csv: async (report, filePath) => {
    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(report.data);
    await fs.writeFile(filePath, csv);
    logger.log(chalk.green(`  ✓ CSV file saved: ${filePath}`));
  },

  // Excel format
  excel: async (report, filePath) => {
    const workbook = new ExcelJS.Workbook();
    
    // Data sheet
    const dataSheet = workbook.addWorksheet('Data');
    if (report.data.length > 0) {
      dataSheet.columns = Object.keys(report.data[0]).map(key => ({
        header: key,
        key,
        width: 20,
      }));
      dataSheet.addRows(report.data);
    }

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Report Title', report.title]);
    summarySheet.addRow(['Generated Date', moment().format('DD/MM/YYYY HH:mm:ss')]);
    summarySheet.addRow(['Period', `${moment(config.startDate).format('DD/MM/YYYY')} - ${moment(config.endDate).format('DD/MM/YYYY')}`]);
    summarySheet.addRow([]);
    
    Object.entries(report.summary).forEach(([key, value]) => {
      if (typeof value === 'object') {
        summarySheet.addRow([key, '']);
        Object.entries(value).forEach(([k, v]) => {
          summarySheet.addRow([`  ${k}`, v]);
        });
      } else {
        summarySheet.addRow([key, value]);
      }
    });

    // Style the header
    dataSheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).font = { bold: true };

    await workbook.xlsx.writeFile(filePath);
    logger.log(chalk.green(`  ✓ Excel file saved: ${filePath}`));
  },

  // JSON format
  json: async (report, filePath) => {
    const output = {
      metadata: {
        title: report.title,
        generatedAt: new Date().toISOString(),
        period: {
          start: config.startDate,
          end: config.endDate,
        },
        summary: report.summary,
      },
      data: report.data,
    };
    await fs.writeJson(filePath, output, { spaces: 2 });
    logger.log(chalk.green(`  ✓ JSON file saved: ${filePath}`));
  },

  // PDF format
  pdf: async (report, filePath) => {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Title
      doc.fontSize(20).text(report.title, { align: 'center' });
      doc.moveDown();

      // Metadata
      doc.fontSize(10).text(`Generated: ${moment().format('DD/MM/YYYY HH:mm:ss')}`);
      doc.text(`Period: ${moment(config.startDate).format('DD/MM/YYYY')} - ${moment(config.endDate).format('DD/MM/YYYY')}`);
      doc.moveDown();

      // Summary
      doc.fontSize(14).text('Summary', { underline: true });
      doc.moveDown(0.5);
      
      Object.entries(report.summary).forEach(([key, value]) => {
        if (typeof value === 'object') {
          doc.fontSize(12).text(key);
          Object.entries(value).forEach(([k, v]) => {
            doc.fontSize(10).text(`  ${k}: ${v}`, { indent: 20 });
          });
        } else {
          doc.fontSize(10).text(`${key}: ${value}`);
        }
      });

      doc.addPage();

      // Data table
      doc.fontSize(14).text('Detailed Data', { underline: true });
      doc.moveDown();

      if (report.data.length > 0) {
        const headers = Object.keys(report.data[0]);
        const columnWidth = 500 / headers.length;

        // Draw headers
        let y = doc.y;
        headers.forEach((header, i) => {
          doc.fontSize(8).text(header, 50 + i * columnWidth, y, {
            width: columnWidth - 5,
            align: 'left',
          });
        });

        // Draw line
        doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();

        // Draw data
        let rowY = y + 25;
        for (const row of report.data.slice(0, 50)) { // Limit to 50 rows for PDF
          headers.forEach((header, i) => {
            const value = row[header]?.toString() || '';
            doc.fontSize(7).text(value, 50 + i * columnWidth, rowY, {
              width: columnWidth - 5,
              align: 'left',
            });
          });
          rowY += 20;

          // Add new page if needed
          if (rowY > 750) {
            doc.addPage();
            rowY = 50;
          }
        }

        if (report.data.length > 50) {
          doc.fontSize(8).text(`... and ${report.data.length - 50} more rows`, 50, rowY);
        }
      }

      doc.end();

      stream.on('finish', () => {
        logger.log(chalk.green(`  ✓ PDF file saved: ${filePath}`));
        resolve();
      });

      stream.on('error', reject);
    });
  },
};

// Main function
const generateReport = async () => {
  try {
    logger.log(chalk.blue('\n📊 Starting report generation...'));
    logger.log(chalk.white(`Type: ${config.reportType}`));
    logger.log(chalk.white(`Format: ${config.format}`));
    logger.log(chalk.white(`Period: ${moment(config.startDate).format('DD/MM/YYYY')} - ${moment(config.endDate).format('DD/MM/YYYY')}`));

    // Connect to MongoDB
    await mongoose.connect(config.mongodbUri);
    logger.log(chalk.green('✅ Connected to MongoDB'));

    // Generate report data
    const generator = reportGenerators[config.reportType];
    if (!generator) {
      throw new Error(`Unknown report type: ${config.reportType}`);
    }

    const report = await generator();
    logger.log(chalk.green(`✅ Report data generated: ${report.data.length} records`));

    // Save report
    const timestamp = moment().format('YYYYMMDD_HHmmss');
    const fileName = `${report.filename}_${timestamp}.${config.format}`;
    const filePath = path.join(config.outputDir, fileName);

    const formatter = formatters[config.format];
    if (!formatter) {
      throw new Error(`Unknown format: ${config.format}`);
    }

    await formatter(report, filePath);

    // Show summary
    logger.log(chalk.blue('\n📈 Report Summary:'));
    Object.entries(report.summary).forEach(([key, value]) => {
      if (typeof value === 'object') {
        logger.log(chalk.white(`  ${key}:`));
        Object.entries(value).forEach(([k, v]) => {
          logger.log(chalk.white(`    ${k}: ${v}`));
        });
      } else {
        logger.log(chalk.white(`  ${key}: ${value}`));
      }
    });

    logger.log(chalk.green(`\n✅ Report generated successfully: ${filePath}`));

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error(chalk.red('\n❌ Report generation failed:'), error);
    process.exit(1);
  }
};

// Run report generation
generateReport();