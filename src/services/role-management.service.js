const { Admin, User } = require('../models');
const { AppError } = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter } = require('../events');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

class RoleManagementService {
  constructor() {
    // Predefined role templates
    this.roleTemplates = {
      super_admin: {
        name: 'Super Admin',
        description: 'Full system access with all permissions',
        permissions: {
          users: { view: true, create: true, edit: true, delete: true, block: true, verifyKyc: true },
          vendors: { view: true, approve: true, suspend: true, manageCommission: true, viewPayouts: true },
          products: { view: true, create: true, edit: true, delete: true, approve: true, feature: true },
          rentals: { view: true, manage: true, cancel: true, refund: true, disputeResolution: true },
          payments: { view: true, process: true, refund: true, adjust: true, viewPayouts: true },
          inventory: { view: true, manage: true, transfer: true, writeoff: true },
          maintenance: { view: true, assign: true, approveCharges: true },
          discounts: { view: true, create: true, edit: true, delete: true },
          content: { manageCategories: true, manageBlog: true, manageFaqs: true, managePages: true },
          analytics: { view: true, export: true, manageReports: true },
          admins: { view: true, create: true, edit: true, delete: true, manageRoles: true },
          system: { manageSettings: true, viewLogs: true, manageBackup: true, manageMaintenance: true }
        }
      },
      admin: {
        name: 'Admin',
        description: 'General administrator with broad access',
        permissions: {
          users: { view: true, create: true, edit: true, block: true, verifyKyc: false },
          vendors: { view: true, approve: true, suspend: false, manageCommission: false, viewPayouts: true },
          products: { view: true, create: false, edit: true, delete: false, approve: true, feature: true },
          rentals: { view: true, manage: true, cancel: true, refund: false, disputeResolution: true },
          payments: { view: true, process: false, refund: true, adjust: false, viewPayouts: true },
          inventory: { view: true, manage: true, transfer: false, writeoff: false },
          maintenance: { view: true, assign: true, approveCharges: false },
          discounts: { view: true, create: true, edit: true, delete: false },
          content: { manageCategories: true, manageBlog: false, manageFaqs: true, managePages: false },
          analytics: { view: true, export: true, manageReports: false },
          admins: { view: true, create: false, edit: false, delete: false, manageRoles: false },
          system: { manageSettings: false, viewLogs: true, manageBackup: false, manageMaintenance: false }
        }
      },
      operations_manager: {
        name: 'Operations Manager',
        description: 'Manages day-to-day operations',
        permissions: {
          users: { view: true, create: false, edit: false, block: false, verifyKyc: false },
          vendors: { view: true, approve: true, suspend: false, manageCommission: false, viewPayouts: true },
          products: { view: true, create: false, edit: false, delete: false, approve: true, feature: false },
          rentals: { view: true, manage: true, cancel: true, refund: false, disputeResolution: true },
          payments: { view: true, process: false, refund: false, adjust: false, viewPayouts: false },
          inventory: { view: true, manage: true, transfer: true, writeoff: false },
          maintenance: { view: true, assign: true, approveCharges: true },
          discounts: { view: true, create: false, edit: false, delete: false },
          content: { manageCategories: false, manageBlog: false, manageFaqs: false, managePages: false },
          analytics: { view: true, export: false, manageReports: false },
          admins: { view: false, create: false, edit: false, delete: false, manageRoles: false },
          system: { manageSettings: false, viewLogs: false, manageBackup: false, manageMaintenance: false }
        }
      },
      support_manager: {
        name: 'Support Manager',
        description: 'Manages customer support tickets',
        permissions: {
          users: { view: true, create: false, edit: true, block: true, verifyKyc: false },
          vendors: { view: true, approve: false, suspend: false, manageCommission: false, viewPayouts: false },
          products: { view: true, create: false, edit: false, delete: false, approve: false, feature: false },
          rentals: { view: true, manage: true, cancel: false, refund: false, disputeResolution: true },
          payments: { view: true, process: false, refund: false, adjust: false, viewPayouts: false },
          inventory: { view: true, manage: false, transfer: false, writeoff: false },
          maintenance: { view: true, assign: true, approveCharges: false },
          discounts: { view: true, create: false, edit: false, delete: false },
          content: { manageCategories: false, manageBlog: false, manageFaqs: false, managePages: false },
          analytics: { view: true, export: false, manageReports: false },
          admins: { view: false, create: false, edit: false, delete: false, manageRoles: false },
          system: { manageSettings: false, viewLogs: false, manageBackup: false, manageMaintenance: false }
        }
      },
      finance_manager: {
        name: 'Finance Manager',
        description: 'Manages payments, payouts, and financial reports',
        permissions: {
          users: { view: true, create: false, edit: false, block: false, verifyKyc: false },
          vendors: { view: true, approve: false, suspend: false, manageCommission: true, viewPayouts: true },
          products: { view: true, create: false, edit: false, delete: false, approve: false, feature: false },
          rentals: { view: true, manage: false, cancel: false, refund: false, disputeResolution: false },
          payments: { view: true, process: true, refund: true, adjust: true, viewPayouts: true },
          inventory: { view: true, manage: false, transfer: false, writeoff: false },
          maintenance: { view: true, assign: false, approveCharges: false },
          discounts: { view: true, create: true, edit: true, delete: true },
          content: { manageCategories: false, manageBlog: false, manageFaqs: false, managePages: false },
          analytics: { view: true, export: true, manageReports: true },
          admins: { view: false, create: false, edit: false, delete: false, manageRoles: false },
          system: { manageSettings: false, viewLogs: false, manageBackup: false, manageMaintenance: false }
        }
      },
      inventory_manager: {
        name: 'Inventory Manager',
        description: 'Manages product inventory and stock',
        permissions: {
          users: { view: false, create: false, edit: false, block: false, verifyKyc: false },
          vendors: { view: true, approve: false, suspend: false, manageCommission: false, viewPayouts: false },
          products: { view: true, create: true, edit: true, delete: false, approve: false, feature: false },
          rentals: { view: true, manage: false, cancel: false, refund: false, disputeResolution: false },
          payments: { view: false, process: false, refund: false, adjust: false, viewPayouts: false },
          inventory: { view: true, manage: true, transfer: true, writeoff: true },
          maintenance: { view: true, assign: false, approveCharges: false },
          discounts: { view: false, create: false, edit: false, delete: false },
          content: { manageCategories: false, manageBlog: false, manageFaqs: false, managePages: false },
          analytics: { view: true, export: true, manageReports: false },
          admins: { view: false, create: false, edit: false, delete: false, manageRoles: false },
          system: { manageSettings: false, viewLogs: false, manageBackup: false, manageMaintenance: false }
        }
      },
      content_manager: {
        name: 'Content Manager',
        description: 'Manages website content, categories, and pages',
        permissions: {
          users: { view: false, create: false, edit: false, block: false, verifyKyc: false },
          vendors: { view: true, approve: false, suspend: false, manageCommission: false, viewPayouts: false },
          products: { view: true, create: false, edit: false, delete: false, approve: false, feature: true },
          rentals: { view: false, manage: false, cancel: false, refund: false, disputeResolution: false },
          payments: { view: false, process: false, refund: false, adjust: false, viewPayouts: false },
          inventory: { view: false, manage: false, transfer: false, writeoff: false },
          maintenance: { view: false, assign: false, approveCharges: false },
          discounts: { view: true, create: true, edit: true, delete: false },
          content: { manageCategories: true, manageBlog: true, manageFaqs: true, managePages: true },
          analytics: { view: true, export: false, manageReports: false },
          admins: { view: false, create: false, edit: false, delete: false, manageRoles: false },
          system: { manageSettings: false, viewLogs: false, manageBackup: false, manageMaintenance: false }
        }
      },
      analytics_viewer: {
        name: 'Analytics Viewer',
        description: 'Read-only access to analytics and reports',
        permissions: {
          users: { view: false, create: false, edit: false, block: false, verifyKyc: false },
          vendors: { view: true, approve: false, suspend: false, manageCommission: false, viewPayouts: false },
          products: { view: true, create: false, edit: false, delete: false, approve: false, feature: false },
          rentals: { view: true, manage: false, cancel: false, refund: false, disputeResolution: false },
          payments: { view: true, process: false, refund: false, adjust: false, viewPayouts: true },
          inventory: { view: true, manage: false, transfer: false, writeoff: false },
          maintenance: { view: true, assign: false, approveCharges: false },
          discounts: { view: true, create: false, edit: false, delete: false },
          content: { view: true, manage: false },
          analytics: { view: true, export: false, manageReports: false },
          admins: { view: false, create: false, edit: false, delete: false, manageRoles: false },
          system: { view: true, manage: false }
        }
      },
      auditor: {
        name: 'Auditor',
        description: 'Audit logs and compliance monitoring',
        permissions: {
          users: { view: true, create: false, edit: false, block: false, verifyKyc: false },
          vendors: { view: true, approve: false, suspend: false, manageCommission: false, viewPayouts: true },
          products: { view: true, create: false, edit: false, delete: false, approve: false, feature: false },
          rentals: { view: true, manage: false, cancel: false, refund: false, disputeResolution: true },
          payments: { view: true, process: false, refund: false, adjust: false, viewPayouts: true },
          inventory: { view: true, manage: false, transfer: false, writeoff: false },
          maintenance: { view: true, assign: false, approveCharges: false },
          discounts: { view: true, create: false, edit: false, delete: false },
          content: { view: true, manage: false },
          analytics: { view: true, export: true, manageReports: false },
          admins: { view: true, create: false, edit: false, delete: false, manageRoles: false },
          system: { view: true, manage: false, viewLogs: true }
        }
      }
    };
  }

  /**
   * Create new admin with specific role
   */
  async createAdmin(adminData, createdBy) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        email,
        phone,
        password,
        profile,
        role,
        customPermissions
      } = adminData;

      // Check if admin already exists
      const existingAdmin = await Admin.findOne({
        $or: [{ email: email.toLowerCase() }, { phone }]
      }).session(session);

      if (existingAdmin) {
        throw new AppError('Admin already exists with this email or phone', 409);
      }

      // Get role template
      const roleTemplate = this.roleTemplates[role];
      if (!roleTemplate) {
        throw new AppError('Invalid role specified', 400);
      }

      // Generate employee ID
      const employeeId = await this.generateEmployeeId(profile.department);

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create admin
      const admin = await Admin.create([{
        email: email.toLowerCase(),
        phone,
        password: hashedPassword,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar,
          department: profile.department,
          designation: profile.designation,
          employeeId,
          joiningDate: new Date(),
          reportingTo: profile.reportingTo
        },
        role,
        permissions: customPermissions || roleTemplate.permissions,
        access: {
          twoFactorEnabled: false,
          sessionTimeout: 60,
          maxSessions: 3,
          requirePasswordChange: true,
          passwordLastChanged: new Date()
        },
        security: {
          emailVerified: false,
          phoneVerified: false,
          failedLoginAttempts: 0
        },
        status: {
          isActive: true,
          isBlocked: false
        },
        metadata: {
          createdBy
        }
      }], { session });

      // Create linked user
      const user = await User.create([{
        email: email.toLowerCase(),
        phone,
        password: hashedPassword,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar
        },
        role: 'admin',
        verification: {
          email: false,
          phone: false
        },
        status: {
          isActive: true,
          isBlocked: false
        }
      }], { session });

      // Link admin to user
      admin[0].user = user[0]._id;
      await admin[0].save({ session });

      await session.commitTransaction();

      // Send welcome email
      await this.sendAdminWelcomeEmail(admin[0], password);

      // Log creation
      await admin[0].logAction('ADMIN_CREATED', 'Admin', admin[0]._id, {
        createdBy: createdBy?.toString(),
        role
      });

      // Remove sensitive data
      const adminResponse = admin[0].toObject();
      delete adminResponse.password;
      delete adminResponse.access.twoFactorSecret;

      return {
        admin: adminResponse,
        message: `Admin created successfully with role: ${roleTemplate.name}`
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createAdmin:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update admin role
   */
  async updateAdminRole(adminId, newRole, updatedBy) {
    try {
      const admin = await Admin.findById(adminId);
      
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      if (admin.role === 'super_admin' && newRole !== 'super_admin') {
        throw new AppError('Cannot demote super admin', 403);
      }

      const oldRole = admin.role;
      const roleTemplate = this.roleTemplates[newRole];
      
      if (!roleTemplate) {
        throw new AppError('Invalid role', 400);
      }

      admin.role = newRole;
      admin.permissions = roleTemplate.permissions;
      admin.metadata.updatedBy = updatedBy;
      
      await admin.save();

      // Log role change
      await admin.logAction('ROLE_CHANGED', 'Admin', admin._id, {
        oldRole,
        newRole,
        updatedBy
      });

      return {
        admin,
        oldRole,
        newRole,
        message: `Role updated from ${oldRole} to ${newRole}`
      };
    } catch (error) {
      logger.error('Error in updateAdminRole:', error);
      throw error;
    }
  }

  /**
   * Get all admins with roles
   */
  async getAllAdmins(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = {};
      if (filters.role) query.role = filters.role;
      if (filters.department) query['profile.department'] = filters.department;
      if (filters.status) query['status.isActive'] = filters.status === 'active';
      if (filters.search) {
        query.$or = [
          { email: new RegExp(filters.search, 'i') },
          { 'profile.firstName': new RegExp(filters.search, 'i') },
          { 'profile.lastName': new RegExp(filters.search, 'i') }
        ];
      }

      const [admins, total] = await Promise.all([
        Admin.find(query)
          // NOTE: password, access.twoFactorSecret and access.backupCodes.code
          // are already `select: false` in the schema, so they are excluded by
          // default. Do NOT add `-access.backupCodes` here: excluding that
          // parent path collides with the schema-level deselect of its nested
          // `.code` field and throws a Mongoose "Path collision" error.
          .populate('user', 'email phone')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Admin.countDocuments(query)
      ]);

      // Drop the non-sensitive remnants of the backupCodes array so the admin
      // list never leaks 2FA recovery metadata.
      admins.forEach((admin) => {
        if (admin.access) delete admin.access.backupCodes;
      });

      return {
        admins,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getAllAdmins:', error);
      throw error;
    }
  }

  /**
   * Get role details
   */
  getRoleDetails(role) {
    const roleTemplate = this.roleTemplates[role];
    if (!roleTemplate) {
      throw new AppError('Role not found', 404);
    }
    return roleTemplate;
  }

  /**
   * List all available roles
   */
  listAllRoles() {
    return Object.entries(this.roleTemplates).map(([key, value]) => ({
      id: key,
      name: value.name,
      description: value.description,
      permissions: value.permissions
    }));
  }

  /**
   * Update custom permissions for admin
   */
  async updatePermissions(adminId, permissions, updatedBy) {
    try {
      const admin = await Admin.findById(adminId);
      
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      if (admin.role === 'super_admin') {
        throw new AppError('Cannot modify super admin permissions', 403);
      }

      // Merge with existing permissions
      admin.permissions = this.mergePermissions(admin.permissions, permissions);
      admin.metadata.updatedBy = updatedBy;
      
      await admin.save();

      // Log permission change
      await admin.logAction('PERMISSIONS_UPDATED', 'Admin', admin._id, {
        changes: permissions,
        updatedBy
      });

      return admin;
    } catch (error) {
      logger.error('Error in updatePermissions:', error);
      throw error;
    }
  }

  /**
   * Merge permissions (deep merge)
   */
  mergePermissions(existing, updates) {
    const result = { ...existing };
    
    for (const [resource, actions] of Object.entries(updates)) {
      if (result[resource]) {
        result[resource] = { ...result[resource], ...actions };
      } else {
        result[resource] = actions;
      }
    }
    
    return result;
  }

  /**
   * Generate employee ID
   */
  async generateEmployeeId(department) {
    const deptCode = {
      super_admin: 'SA',
      operations: 'OPS',
      customer_support: 'CS',
      vendor_management: 'VM',
      finance: 'FIN',
      inventory: 'INV',
      marketing: 'MKT',
      technical: 'TECH',
      legal: 'LEG',
      hr: 'HR'
    };

    const prefix = deptCode[department] || 'ADM';
    const count = await Admin.countDocuments({ 'profile.department': department }) + 1;
    const sequential = String(count).padStart(4, '0');
    
    return `${prefix}${sequential}`;
  }

  /**
   * Send admin welcome email
   */
  async sendAdminWelcomeEmail(admin, tempPassword) {
    const loginUrl = `${process.env.ADMIN_URL}/login`;
    
    await addJob('email', 'send', {
      to: admin.email,
      subject: 'Welcome to RentEase Admin Panel',
      template: 'admin-welcome',
      data: {
        name: `${admin.profile.firstName} ${admin.profile.lastName}`,
        email: admin.email,
        tempPassword,
        loginUrl,
        role: this.roleTemplates[admin.role]?.name || admin.role,
        employeeId: admin.profile.employeeId,
        department: admin.profile.department
      }
    });
  }

  /**
   * Deactivate admin
   */
  async deactivateAdmin(adminId, reason, deactivatedBy) {
    try {
      const admin = await Admin.findById(adminId);
      
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      if (admin.role === 'super_admin') {
        throw new AppError('Cannot deactivate super admin', 403);
      }

      admin.status.isActive = false;
      admin.status.deactivatedAt = new Date();
      admin.status.deactivationReason = reason;
      admin.metadata.deletedBy = deactivatedBy;
      
      await admin.save();

      // Deactivate linked user
      if (admin.user) {
        await User.findByIdAndUpdate(admin.user, {
          'status.isActive': false
        });
      }

      // Log deactivation
      await admin.logAction('ADMIN_DEACTIVATED', 'Admin', admin._id, {
        reason,
        deactivatedBy
      });

      return { message: 'Admin deactivated successfully' };
    } catch (error) {
      logger.error('Error in deactivateAdmin:', error);
      throw error;
    }
  }

  /**
   * Reactivate admin
   */
  async reactivateAdmin(adminId, reactivatedBy) {
    try {
      const admin = await Admin.findById(adminId);
      
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      admin.status.isActive = true;
      admin.status.deactivatedAt = null;
      admin.status.deactivationReason = null;
      admin.metadata.updatedBy = reactivatedBy;
      
      await admin.save();

      // Reactivate linked user
      if (admin.user) {
        await User.findByIdAndUpdate(admin.user, {
          'status.isActive': true
        });
      }

      // Log reactivation
      await admin.logAction('ADMIN_REACTIVATED', 'Admin', admin._id, {
        reactivatedBy
      });

      return { message: 'Admin reactivated successfully' };
    } catch (error) {
      logger.error('Error in reactivateAdmin:', error);
      throw error;
    }
  }
}

module.exports = new RoleManagementService();