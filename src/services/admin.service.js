const {
  User,
  Vendor,
  Admin,
  Product,
  Rental,
  Payment,
  Review,
  Notification,
  Maintenance,
} = require("../models");
const { AppError } = require("../utils/AppError");
const { addJob } = require("../jobs");
const { eventEmitter } = require("../events");
const { getRedisClient } = require("../config/redis");
const logger = require("../config/logger");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const excel = require("exceljs");
const PDFDocument = require("pdfkit");

class AdminService {
  constructor() {
    this.redisClient = getRedisClient();
  }

  /**
   * Create new admin
   */
  async createAdmin(adminData, createdBy) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { email, phone, password, profile, role, permissions } = adminData;

      // Check if user already exists
      let user = await User.findOne({
        $or: [{ email }, { phone }],
      }).session(session);

      if (user) {
        throw new AppError("User already exists with this email or phone", 409);
      }

      // Create user account
      const hashedPassword = await bcrypt.hash(password, 12);

      user = await User.create(
        [
          {
            email,
            phone,
            password: hashedPassword,
            profile: {
              firstName: profile.firstName,
              lastName: profile.lastName,
              avatar: profile.avatar,
            },
            role: "admin",
            verification: {
              email: true,
              phone: true,
            },
            status: {
              isActive: true,
            },
            metadata: {
              createdBy,
            },
          },
        ],
        { session },
      );

      // Create admin profile
      const admin = await Admin.create(
        [
          {
            user: user[0]._id,
            email,
            profile: {
              firstName: profile.firstName,
              lastName: profile.lastName,
              department: profile.department,
              designation: profile.designation,
              employeeId: profile.employeeId,
            },
            role,
            permissions: permissions || this.getDefaultPermissions(role),
            access: {
              twoFactorEnabled: false,
              sessionTimeout: 60,
              maxSessions: 3,
            },
            metadata: {
              createdBy,
            },
          },
        ],
        { session },
      );

      await session.commitTransaction();

      // Send welcome email
      await addJob("email", "send", {
        to: email,
        subject: "Welcome to RentEase Admin Team",
        template: "admin-welcome",
        data: {
          name: profile.firstName,
          email,
          password: "********",
          loginUrl: `${process.env.ADMIN_URL}/login`,
        },
      });

      return admin[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in createAdmin:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get default permissions based on role
   */
  getDefaultPermissions(role) {
    const basePermissions = {
      users: {
        view: true,
        create: false,
        edit: false,
        delete: false,
        block: false,
      },
      vendors: { view: true, approve: false, suspend: false },
      products: { view: true, approve: false, feature: false },
      rentals: { view: true, manage: false, cancel: false },
      payments: { view: true, refund: false },
      content: { manage: false },
      analytics: { view: true, export: false },
      admins: { view: false, create: false, edit: false, delete: false },
    };

    switch (role) {
      case "super_admin":
        return {
          users: {
            view: true,
            create: true,
            edit: true,
            delete: true,
            block: true,
          },
          vendors: { view: true, approve: true, suspend: true },
          products: { view: true, approve: true, feature: true },
          rentals: { view: true, manage: true, cancel: true },
          payments: { view: true, refund: true },
          content: { manage: true },
          analytics: { view: true, export: true },
          admins: { view: true, create: true, edit: true, delete: true },
        };

      case "admin":
        return {
          ...basePermissions,
          users: {
            ...basePermissions.users,
            create: true,
            edit: true,
            block: true,
          },
          vendors: { ...basePermissions.vendors, approve: true, suspend: true },
          products: {
            ...basePermissions.products,
            approve: true,
            feature: true,
          },
          rentals: { ...basePermissions.rentals, manage: true },
          payments: { ...basePermissions.payments, refund: true },
          analytics: { ...basePermissions.analytics, export: true },
        };

      case "operations_manager":
        return {
          ...basePermissions,
          vendors: { ...basePermissions.vendors, approve: true },
          products: { ...basePermissions.products, approve: true },
          rentals: { ...basePermissions.rentals, manage: true },
          analytics: { view: true, export: false },
        };

      case "support_manager":
        return {
          ...basePermissions,
          users: {
            ...basePermissions.users,
            view: true,
            edit: true,
            block: true,
          },
          rentals: { ...basePermissions.rentals, view: true },
          analytics: { view: true, export: false },
        };

      case "finance_manager":
        return {
          ...basePermissions,
          payments: { view: true, refund: true },
          rentals: { view: true },
          analytics: { view: true, export: true },
        };

      default:
        return basePermissions;
    }
  }

  /**
   * Get all admins
   */
  async getAdmins(page = 1, limit = 10, filters = {}) {
    console.log("hii");
    try {
      const skip = (page - 1) * limit;

      const query = {};

      if (filters.role) {
        query.role = filters.role;
      }

      if (filters.department) {
        query["profile.department"] = filters.department;
      }

      if (filters.status) {
        query["status.isActive"] = filters.status === "active";
      }

      if (filters.search) {
        query.$or = [
          { "profile.firstName": new RegExp(filters.search, "i") },
          { "profile.lastName": new RegExp(filters.search, "i") },
          { email: new RegExp(filters.search, "i") },
        ];
      }

      const [admins, total] = await Promise.all([
        Admin.find(query)
          .populate("user", "email phone lastLogin")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Admin.countDocuments(query),
      ]);

      return {
        admins,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getAdmins:", error);
      throw error;
    }
  }

  /**
   * Get admin by ID
   */
  async getAdminById(adminId) {
    console.log("hi admin ID", adminId);
    try {
      const admin = await Admin.findById(adminId)
        .populate("user", "email phone lastLogin loginHistory")
        .populate("createdBy", "profile.firstName profile.lastName email")
        .populate("updatedBy", "profile.firstName profile.lastName email")
        .lean();

      if (!admin) {
        throw new AppError("Admin not found", 404);
      }

      // Get recent activity
      const recentActivity = await this.getAdminActivity(adminId, 1, 10);

      return {
        ...admin,
        recentActivity: recentActivity.activities,
      };
    } catch (error) {
      logger.error("Error in getAdminById:", error);
      throw error;
    }
  }

  /**
   * Update admin
   */
  async updateAdmin(adminId, updateData, updatedBy) {
    try {
      const { profile, role, permissions, status } = updateData;

      const admin = await Admin.findById(adminId);

      if (!admin) {
        throw new AppError("Admin not found", 404);
      }

      // Update fields
      if (profile) {
        admin.profile = { ...admin.profile, ...profile };
      }

      if (role && role !== admin.role) {
        admin.role = role;
        // Update permissions based on new role
        admin.permissions = this.getDefaultPermissions(role);
      }

      if (permissions) {
        admin.permissions = { ...admin.permissions, ...permissions };
      }

      if (status) {
        admin.status = { ...admin.status, ...status };
      }

      admin.metadata.updatedBy = updatedBy;
      await admin.save();

      // Update user status if needed
      if (status?.isActive !== undefined) {
        await User.findByIdAndUpdate(admin.user, {
          "status.isActive": status.isActive,
        });
      }

      return admin;
    } catch (error) {
      logger.error("Error in updateAdmin:", error);
      throw error;
    }
  }

  /**
   * Delete admin
   */
  async deleteAdmin(adminId, deletedBy) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const admin = await Admin.findById(adminId).session(session);

      if (!admin) {
        throw new AppError("Admin not found", 404);
      }

      // Soft delete
      admin.status.isActive = false;
      admin.status.deletedAt = new Date();
      admin.status.deletedBy = deletedBy;
      admin.status.deletedReason = "Admin deleted by another admin";

      await admin.save({ session });

      // Deactivate user account
      await User.findByIdAndUpdate(
        admin.user,
        { "status.isActive": false },
        { session },
      );

      await session.commitTransaction();

      return { message: "Admin deactivated successfully" };
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in deleteAdmin:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get admin activity
   */
  async getAdminActivity(adminId, page = 1, limit = 20) {
    try {
      const AdminActivity = require("../models/AdminActivity.model");
      const skip = (page - 1) * limit;

      const [activities, total] = await Promise.all([
        AdminActivity.find({ admin: adminId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AdminActivity.countDocuments({ admin: adminId }),
      ]);

      return {
        activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getAdminActivity:", error);
      throw error;
    }
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats() {
    try {
      const cacheKey = "admin:dashboard:stats";

      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        userStats,
        vendorStats,
        productStats,
        rentalStats,
        revenueStats,
        pendingStats,
      ] = await Promise.all([
        // User statistics
        User.aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                      $sum: {
                        $cond: [{ $eq: ["$status.isActive", true] }, 1, 0],
                      },
                    },
                    newToday: {
                      $sum: { $cond: [{ $gte: ["$createdAt", today] }, 1, 0] },
                    },
                    newThisMonth: {
                      $sum: {
                        $cond: [{ $gte: ["$createdAt", thisMonth] }, 1, 0],
                      },
                    },
                  },
                },
              ],
              byRole: [
                {
                  $group: {
                    _id: "$role",
                    count: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ]),

        // Vendor statistics
        Vendor.aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    verified: {
                      $sum: {
                        $cond: [
                          { $eq: ["$verification.status", "verified"] },
                          1,
                          0,
                        ],
                      },
                    },
                    pending: {
                      $sum: {
                        $cond: [
                          { $eq: ["$verification.status", "pending"] },
                          1,
                          0,
                        ],
                      },
                    },
                    newToday: {
                      $sum: { $cond: [{ $gte: ["$createdAt", today] }, 1, 0] },
                    },
                  },
                },
              ],
              byPlan: [
                {
                  $group: {
                    _id: "$subscription.plan",
                    count: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ]),

        // Product statistics
        Product.aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                      $sum: {
                        $cond: [{ $eq: ["$status.isActive", true] }, 1, 0],
                      },
                    },
                    pending: {
                      $sum: {
                        $cond: [
                          { $eq: ["$status.approvalStatus", "pending"] },
                          1,
                          0,
                        ],
                      },
                    },
                  },
                },
              ],
              byCategory: [
                {
                  $lookup: {
                    from: "categories",
                    localField: "category",
                    foreignField: "_id",
                    as: "category",
                  },
                },
                { $unwind: "$category" },
                {
                  $group: {
                    _id: "$category.name",
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $limit: 5 },
              ],
            },
          },
        ]),

        // Rental statistics
        Rental.aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                      $sum: {
                        $cond: [
                          { $in: ["$status", ["active", "confirmed"]] },
                          1,
                          0,
                        ],
                      },
                    },
                    completed: {
                      $sum: {
                        $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
                      },
                    },
                    cancelled: {
                      $sum: {
                        $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0],
                      },
                    },
                    overdue: {
                      $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] },
                    },
                    today: {
                      $sum: { $cond: [{ $gte: ["$createdAt", today] }, 1, 0] },
                    },
                  },
                },
              ],
              revenue: [
                {
                  $match: { status: { $in: ["completed", "active"] } },
                },
                {
                  $group: {
                    _id: null,
                    total: { $sum: "$rentalDetails.totalAmount" },
                    today: {
                      $sum: {
                        $cond: [
                          { $gte: ["$createdAt", today] },
                          "$rentalDetails.totalAmount",
                          0,
                        ],
                      },
                    },
                    thisMonth: {
                      $sum: {
                        $cond: [
                          { $gte: ["$createdAt", thisMonth] },
                          "$rentalDetails.totalAmount",
                          0,
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        ]),

        // Pending items statistics
        Promise.all([
          Vendor.countDocuments({ "verification.status": "pending" }),
          Product.countDocuments({ "status.approvalStatus": "pending" }),
          Review.countDocuments({ "moderation.status": "pending" }),
          Maintenance.countDocuments({ status: "pending" }),
        ]).then(
          ([
            pendingVendors,
            pendingProducts,
            pendingReviews,
            pendingMaintenance,
          ]) => ({
            vendors: pendingVendors,
            products: pendingProducts,
            reviews: pendingReviews,
            maintenance: pendingMaintenance,
          }),
        ),
      ]);

      const stats = {
        users: {
          ...userStats[0]?.totals[0],
          byRole: userStats[0]?.byRole || [],
        },
        vendors: {
          ...vendorStats[0]?.totals[0],
          byPlan: vendorStats[0]?.byPlan || [],
        },
        products: {
          ...productStats[0]?.totals[0],
          byCategory: productStats[0]?.byCategory || [],
        },
        rentals: {
          ...rentalStats[0]?.totals[0],
          revenue: rentalStats[0]?.revenue[0] || {
            total: 0,
            today: 0,
            thisMonth: 0,
          },
        },
        pending: pendingStats,
        timestamp: new Date(),
      };

      // Cache for 5 minutes
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(stats));
      }

      return stats;
    } catch (error) {
      logger.error("Error in getDashboardStats:", error);
      throw error;
    }
  }

  /**
   * Get platform analytics
   */
  async getPlatformAnalytics(startDate, endDate) {
    try {
      const analytics = await Promise.all([
        // User growth
        User.aggregate([
          {
            $match: {
              createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
        ]),

        // Revenue trend
        Payment.aggregate([
          {
            $match: {
              createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
              status: "success",
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" },
              },
              amount: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
        ]),

        // Popular categories
        Product.aggregate([
          {
            $lookup: {
              from: "rentals",
              localField: "_id",
              foreignField: "product",
              as: "rentals",
            },
          },
          {
            $lookup: {
              from: "categories",
              localField: "category",
              foreignField: "_id",
              as: "category",
            },
          },
          { $unwind: "$category" },
          {
            $group: {
              _id: "$category.name",
              rentalCount: { $sum: { $size: "$rentals" } },
              revenue: {
                $sum: {
                  $sum: "$rentals.rentalDetails.totalAmount",
                },
              },
            },
          },
          { $sort: { rentalCount: -1 } },
          { $limit: 10 },
        ]),

        // Top vendors
        Vendor.aggregate([
          {
            $lookup: {
              from: "rentals",
              localField: "user",
              foreignField: "vendor",
              as: "rentals",
            },
          },
          {
            $project: {
              businessName: "$business.name",
              rentalCount: { $size: "$rentals" },
              revenue: {
                $sum: "$rentals.rentalDetails.totalAmount",
              },
              rating: "$performance.rating.average",
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
        ]),
      ]);

      return {
        userGrowth: analytics[0],
        revenueTrend: analytics[1],
        popularCategories: analytics[2],
        topVendors: analytics[3],
        period: { startDate, endDate },
      };
    } catch (error) {
      logger.error("Error in getPlatformAnalytics:", error);
      throw error;
    }
  }

  /**
   * Generate report
   */
  async generateReport(type, format, startDate, endDate) {
    try {
      let data;
      let filename;

      switch (type) {
        case "users":
          data = await this.getUserReportData(startDate, endDate);
          filename = `user-report-${startDate}-to-${endDate}`;
          break;
        case "vendors":
          data = await this.getVendorReportData(startDate, endDate);
          filename = `vendor-report-${startDate}-to-${endDate}`;
          break;
        case "rentals":
          data = await this.getRentalReportData(startDate, endDate);
          filename = `rental-report-${startDate}-to-${endDate}`;
          break;
        case "revenue":
          data = await this.getRevenueReportData(startDate, endDate);
          filename = `revenue-report-${startDate}-to-${endDate}`;
          break;
        case "products":
          data = await this.getProductReportData(startDate, endDate);
          filename = `product-report-${startDate}-to-${endDate}`;
          break;
        default:
          throw new AppError("Invalid report type", 400);
      }

      // Generate file based on format
      if (format === "excel") {
        return await this.generateExcelReport(data, filename);
      } else if (format === "pdf") {
        return await this.generatePDFReport(data, filename);
      } else {
        return {
          data,
          filename: `${filename}.json`,
          contentType: "application/json",
        };
      }
    } catch (error) {
      logger.error("Error in generateReport:", error);
      throw error;
    }
  }

  /**
   * Generate Excel report
   */
  async generateExcelReport(data, filename) {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet("Report");

    // Add headers
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      worksheet.addRow(headers);

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4F81BD" },
      };
    }

    // Add data
    data.forEach((row) => {
      worksheet.addRow(Object.values(row));
    });

    // Auto-size columns
    worksheet.columns.forEach((column) => {
      column.width = 15;
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer,
      filename: `${filename}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  /**
   * Generate PDF report
   */
  async generatePDFReport(data, filename) {
    return new Promise((resolve) => {
      const doc = new PDFDocument();
      const buffers = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfData = Buffer.concat(buffers);
        resolve({
          buffer: pdfData,
          filename: `${filename}.pdf`,
          contentType: "application/pdf",
        });
      });

      // Add title
      doc.fontSize(20).text("RentEase Report", { align: "center" });
      doc.moveDown();
      doc
        .fontSize(12)
        .text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
      doc.moveDown();
      doc.moveDown();

      // Add data as table
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        const columnWidth = 500 / headers.length;

        // Draw headers
        let y = doc.y;
        headers.forEach((header, i) => {
          doc.fontSize(10).text(header, 50 + i * columnWidth, y, {
            width: columnWidth - 5,
            align: "left",
          });
        });

        // Draw line
        doc
          .moveTo(50, y + 15)
          .lineTo(550, y + 15)
          .stroke();

        // Draw data
        let rowY = y + 25;
        data.slice(0, 50).forEach((row) => {
          headers.forEach((header, i) => {
            const value = row[header]?.toString() || "";
            doc.fontSize(8).text(value, 50 + i * columnWidth, rowY, {
              width: columnWidth - 5,
              align: "left",
            });
          });
          rowY += 20;

          if (rowY > 750) {
            doc.addPage();
            rowY = 50;
          }
        });
      }

      doc.end();
    });
  }

  /**
   * Get user report data
   */
  async getUserReportData(startDate, endDate) {
    const users = await User.find({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
    })
      .populate("addresses")
      .lean();

    return users.map((u) => ({
      "User ID": u._id,
      Name: `${u.profile.firstName} ${u.profile.lastName}`,
      Email: u.email,
      Phone: u.phone,
      Role: u.role,
      Verified: u.verification.email ? "Yes" : "No",
      "KYC Status": u.verification.kyc?.status || "N/A",
      "Joined Date": new Date(u.createdAt).toLocaleDateString(),
      "Last Active": u.stats?.lastActive
        ? new Date(u.stats.lastActive).toLocaleDateString()
        : "Never",
      "Total Rentals": u.stats?.totalRentals || 0,
      "Total Spent": u.stats?.totalSpent || 0,
      City: u.addresses[0]?.city || "N/A",
    }));
  }

  /**
   * Get vendor report data
   */
  async getVendorReportData(startDate, endDate) {
    const vendors = await Vendor.find({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
    })
      .populate("user", "email phone")
      .lean();

    return vendors.map((v) => ({
      "Vendor ID": v.vendorId,
      "Business Name": v.business.name,
      "Owner Name": v.user
        ? `${v.user.profile?.firstName} ${v.user.profile?.lastName}`
        : "N/A",
      Email: v.user?.email,
      Phone: v.user?.phone,
      GSTIN: v.business.gstin,
      Status: v.verification.status,
      Plan: v.subscription.plan,
      Rating: v.performance.rating.average?.toFixed(1) || "N/A",
      "Total Products": v.products.total,
      "Total Rentals": v.performance.metrics.totalRentals,
      "Total Revenue": v.performance.metrics.totalRevenue,
      "Joined Date": new Date(v.createdAt).toLocaleDateString(),
    }));
  }

  /**
   * Get rental report data
   */
  async getRentalReportData(startDate, endDate) {
    const rentals = await Rental.find({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
    })
      .populate("user", "profile.firstName profile.lastName email")
      .populate("vendor", "business.name")
      .populate("product", "basicInfo.name")
      .lean();

    return rentals.map((r) => ({
      "Rental Number": r.rentalNumber,
      User: r.user
        ? `${r.user.profile.firstName} ${r.user.profile.lastName}`
        : "N/A",
      Vendor: r.vendor?.business.name || "N/A",
      Product: r.product?.basicInfo.name || "N/A",
      "Start Date": new Date(r.rentalDetails.startDate).toLocaleDateString(),
      "End Date": new Date(r.rentalDetails.endDate).toLocaleDateString(),
      Tenure: r.rentalDetails.tenureMonths,
      "Monthly Rent": r.rentalDetails.monthlyRent,
      "Total Amount": r.rentalDetails.totalAmount,
      Status: r.status,
      "Payment Status": r.payment.status,
      "Created Date": new Date(r.createdAt).toLocaleDateString(),
    }));
  }

  /**
   * Get revenue report data
   */
  async getRevenueReportData(startDate, endDate) {
    const payments = await Payment.find({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
      status: "success",
    })
      .populate("user", "profile.firstName profile.lastName email")
      .populate("rental", "rentalNumber")
      .lean();

    return payments.map((p) => ({
      "Payment ID": p.paymentNumber,
      User: p.user
        ? `${p.user.profile.firstName} ${p.user.profile.lastName}`
        : "N/A",
      Rental: p.rental?.rentalNumber || "N/A",
      Amount: p.amount,
      Type: p.type,
      Method: p.method,
      Date: new Date(p.createdAt).toLocaleDateString(),
      "Transaction ID": p.paymentDetails?.transactionId || "N/A",
    }));
  }

  /**
   * Get product report data
   */
  async getProductReportData(startDate, endDate) {
    const products = await Product.find({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
    })
      .populate("vendor", "business.name")
      .populate("category", "name")
      .lean();

    return products.map((p) => ({
      "Product ID": p._id,
      Name: p.basicInfo.name,
      SKU: p.basicInfo.sku,
      Vendor: p.vendor?.business.name || "N/A",
      Category: p.category?.name || "N/A",
      "Monthly Rent": p.pricing.monthlyRent,
      "Security Deposit": p.pricing.securityDeposit,
      Condition: p.condition,
      "Total Quantity": p.inventory.totalQuantity,
      Available: p.inventory.availableQuantity,
      Rating: p.ratings.average?.toFixed(1) || "N/A",
      Status: p.status.isActive ? "Active" : "Inactive",
      "Created Date": new Date(p.createdAt).toLocaleDateString(),
    }));
  }

  /**
   * Get system logs
   */
  async getSystemLogs(page = 1, limit = 50, filters = {}) {
    try {
      const AuditLog = require("../models/AuditLog.model");
      const skip = (page - 1) * limit;

      const query = {};

      if (filters.level) {
        query["details.severity"] = filters.level;
      }

      if (filters.action) {
        query.action = filters.action;
      }

      if (filters.userId) {
        query.user = filters.userId;
      }

      if (filters.startDate || filters.endDate) {
        query.timestamp = {};
        if (filters.startDate)
          query.timestamp.$gte = new Date(filters.startDate);
        if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
      }

      const [logs, total] = await Promise.all([
        AuditLog.find(query)
          .populate("user", "profile.firstName profile.lastName email")
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getSystemLogs:", error);
      throw error;
    }
  }

  /**
   * Get system health with timeouts and parallel processing
   */
  async getSystemHealth() {
    const TIMEOUT_MS = 3000;

    const withTimeout = (promise, fallback, label) =>
      Promise.race([
        promise,
        new Promise((resolve) =>
          setTimeout(() => {
            logger.warn(`${label} health check timed out`);
            resolve(fallback);
          }, TIMEOUT_MS)
        ),
      ]);

    try {
      const [dbStatus, redisStatus, queueStatus] = await Promise.all([
        withTimeout(
          this.getDatabaseLatencyWithTimeout(TIMEOUT_MS),
          { status: "disconnected", latency: -1, error: "timeout" },
          "Database"
        ),
        withTimeout(
          this.getRedisLatencyWithTimeout(TIMEOUT_MS),
          { status: "disconnected", latency: -1, error: "timeout" },
          "Redis"
        ),
        withTimeout(
          this.getQueueStatusWithTimeout(TIMEOUT_MS),
          { error: "timeout" },
          "Queues"
        ),
      ]);

      const metrics = {
        cpu: process.cpuUsage(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        nodeVersion: process.version,
      };

      return {
        status:
          dbStatus.status === "connected" && redisStatus.status === "connected"
            ? "healthy"
            : "degraded",
        timestamp: new Date(),
        database: dbStatus,
        redis: redisStatus,
        queues: queueStatus,
        metrics,
        services: {
          email: process.env.SMTP_HOST ? "configured" : "not configured",
          sms: process.env.TWILIO_ACCOUNT_SID ? "configured" : "not configured",
          storage: process.env.AWS_BUCKET_NAME
            ? "configured"
            : "not configured",
          payment: process.env.RAZORPAY_KEY_ID
            ? "configured"
            : "not configured",
        },
      };
    } catch (error) {
      logger.error("Error in getSystemHealth:", error);
      throw error;
    }
  }

  /**
   * Get database latency with timeout
   */
  async getDatabaseLatencyWithTimeout(timeoutMs = 2000) {
    if (mongoose.connection.readyState !== 1) {
      return { status: "disconnected", latency: -1 };
    }
    const start = Date.now();
    try {
      await Promise.race([
        mongoose.connection.db.admin().ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("ping timeout")), timeoutMs)
        ),
      ]);
      return { status: "connected", latency: Date.now() - start };
    } catch (error) {
      return { status: "error", latency: -1, error: error.message };
    }
  }

  /**
   * Get Redis latency with timeout
   */
  async getRedisLatencyWithTimeout(timeoutMs = 2000) {
    if (!this.redisClient) {
      return { status: "disconnected", latency: -1 };
    }
    const start = Date.now();
    try {
      await Promise.race([
        this.redisClient.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("ping timeout")), timeoutMs)
        ),
      ]);
      return { status: "connected", latency: Date.now() - start };
    } catch (error) {
      return { status: "error", latency: -1, error: error.message };
    }
  }

  /**
   * Get queue status with timeout - processes queues in parallel
   */
  async getQueueStatusWithTimeout(timeoutMs = 3000) {
    const { queues } = require("../jobs");
    const queueNames = Object.keys(queues);

    if (queueNames.length === 0) return {};

    const checkQueue = async ([name, queue]) => {
      try {
        const [waiting, active, completed, failed, isPaused] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.isPaused(),
        ]);
        return [name, { waiting, active, completed, failed, isPaused }];
      } catch (error) {
        return [name, { error: error.message }];
      }
    };

    const queuePromises = queueNames.map((name) =>
      Promise.race([
        checkQueue([name, queues[name]]),
        new Promise((resolve) =>
          setTimeout(() => resolve([name, { error: "timeout" }]), timeoutMs)
        ),
      ])
    );

    const results = await Promise.all(queuePromises);
    return Object.fromEntries(results);
  }

  /**
   * Clear cache
   */
  async clearCache(pattern = "*") {
    try {
      if (!this.redisClient) {
        throw new AppError("Redis not configured", 500);
      }

      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(keys);
      }

      return {
        message: `Cleared ${keys.length} cache keys matching pattern: ${pattern}`,
      };
    } catch (error) {
      logger.error("Error in clearCache:", error);
      throw error;
    }
  }

  /**
   * Run database maintenance
   */
  async runMaintenance(task) {
    try {
      switch (task) {
        case "reindex":
          await this.reindexDatabase();
          return { message: "Database reindexing completed" };

        case "cleanup":
          await this.cleanupOldData();
          return { message: "Old data cleanup completed" };

        case "backup":
          await this.createBackup();
          return { message: "Database backup initiated" };

        default:
          throw new AppError("Invalid maintenance task", 400);
      }
    } catch (error) {
      logger.error("Error in runMaintenance:", error);
      throw error;
    }
  }

  /**
   * Reindex database
   */
  async reindexDatabase() {
    const models = [User, Vendor, Product, Rental, Payment, Review];

    for (const model of models) {
      await model.syncIndexes();
      logger.info(`Reindexed ${model.modelName}`);
    }
  }

  /**
   * Cleanup old data
   */
  async cleanupOldData() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Delete old notifications
    await Notification.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
      read: true,
    });

    // Delete old audit logs
    const AuditLog = require("../models/AuditLog.model");
    await AuditLog.deleteMany({
      timestamp: { $lt: ninetyDaysAgo },
    });

    // Delete expired sessions
    const Session = require("../models/Session.model");
    await Session.deleteMany({
      expiresAt: { $lt: new Date() },
    });
  }

  /**
   * Create database backup
   */
  async createBackup() {
    // This would integrate with backup service
    await addJob("backup", "create", {});
  }

  /**
   * Get audit trail
   */
  async getAuditTrail(resourceType, resourceId, page = 1, limit = 20) {
    try {
      const AuditLog = require("../models/AuditLog.model");
      const skip = (page - 1) * limit;

      const query = {
        "resource.type": resourceType,
        "resource.id": resourceId,
      };

      const [logs, total] = await Promise.all([
        AuditLog.find(query)
          .populate("user", "profile.firstName profile.lastName email")
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getAuditTrail:", error);
      throw error;
    }
  }

  /**
   * Get user activity timeline
   */
  async getUserActivityTimeline(userId, page = 1, limit = 20) {
    try {
      const AuditLog = require("../models/AuditLog.model");
      const skip = (page - 1) * limit;

      const [activities, total] = await Promise.all([
        AuditLog.find({ user: userId })
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments({ user: userId }),
      ]);

      return {
        activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getUserActivityTimeline:", error);
      throw error;
    }
  }
}

module.exports = new AdminService();
