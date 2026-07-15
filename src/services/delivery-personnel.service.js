// services/delivery-personnel.service.js
const { DeliveryPerson, DeliveryTeam, User, Delivery } = require('../models');
const AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

class DeliveryPersonnelService {
  constructor() {
    this.redisClient = getRedisClient();
  }

  /**
   * Generate employee ID
   */
  async generateEmployeeId() {
    const count = await DeliveryPerson.countDocuments();
    const year = new Date().getFullYear().toString().slice(-2);
    return `DLV${year}${(count + 1).toString().padStart(5, '0')}`;
  }

  /**
   * Create delivery person
   */
  async createDeliveryPerson(personData, createdBy) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { email, phone, password, profile, vehicle, zone, serviceablePincodes, bankDetails } = personData;

      // Check if user already exists
      let user = await User.findOne({ 
        $or: [{ email }, { phone }] 
      }).session(session);

      if (user) {
        throw new AppError('User already exists with this email or phone', 409);
      }

      // Create user account
      const hashedPassword = await bcrypt.hash(password, 12);


      user = await User.create([{
        email,
        phone,
        password: hashedPassword,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar
        },
        role: 'delivery',
        verification: {
          email: true,
          phone: true
        },
        status: {
          isActive: true
        }
      }], { session });



      // Generate employee ID
      const employeeId = await this.generateEmployeeId();

      // Create delivery person profile
      // const deliveryPerson = await DeliveryPerson.create([{
      //   user: user[0]._id,
      //   employeeId,
      //   vehicle,
      //   zone,
      //   serviceablePincodes,
      //   bankDetails,
      //   metadata: {
      //     createdBy,
      //     hiredAt: new Date()
      //   }
      // }], { session });

      // In delivery-personnel.service.js - createDeliveryPerson method

      // Create delivery person profile
      const deliveryPerson = await DeliveryPerson.create([{
        user: user[0]._id,
        employeeId,
        vehicle,
        zone,
        serviceablePincodes,
        bankDetails,
        // 🔥 FIX: Initialize currentLocation with proper GeoJSON format
        availability: {
          isAvailable: true,
          isOnDuty: false,
          currentLocation: {
            type: 'Point',
            coordinates: [0, 0], // [longitude, latitude] - default center
            updatedAt: new Date()
          },
          shifts: {
            start: '09:00',
            end: '18:00',
            workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
          }
        },
        // 🔥 FIX: Initialize performance with defaults
        performance: {
          totalDeliveries: 0,
          completedDeliveries: 0,
          failedDeliveries: 0,
          cancelledDeliveries: 0,
          averageRating: 0,
          onTimeRate: 0,
          totalDistance: 0,
          totalEarnings: 0
        },
        // 🔥 FIX: Initialize status
        status: {
          isActive: true,
          isVerified: false,
          verificationStatus: 'pending'
        },
        maxConcurrentDeliveries: 5,
        metadata: {
          createdBy,
          hiredAt: new Date()
        }
      }], { session });

      await session.commitTransaction();

      return deliveryPerson[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createDeliveryPerson:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get all delivery persons
   */
  async getAllDeliveryPersons(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = {};
      if (filters.status) query['status.verificationStatus'] = filters.status;
      if (filters.zone) query.zone = filters.zone;
      if (filters.isAvailable !== undefined) query['availability.isAvailable'] = filters.isAvailable === 'true';
      if (filters.search) {
        const users = await User.find({
          $or: [
            { 'profile.firstName': new RegExp(filters.search, 'i') },
            { 'profile.lastName': new RegExp(filters.search, 'i') },
            { email: new RegExp(filters.search, 'i') }
          ]
        }).distinct('_id');
        query.user = { $in: users };
      }

      const [persons, total] = await Promise.all([
        DeliveryPerson.find(query)
          .populate('user', 'profile firstName lastName email phone')
          .populate('metadata.createdBy', 'profile firstName lastName')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        DeliveryPerson.countDocuments(query)
      ]);

      return {
        persons,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getAllDeliveryPersons:', error);
      throw error;
    }
  }

  /**
   * Get delivery person by ID
   */
  async getDeliveryPersonById(personId) {
    try {
      const person = await DeliveryPerson.findById(personId)
        .populate('user', 'profile firstName lastName email phone')
        .populate('currentAssignments.delivery')
        .lean();

      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }

      return person;
    } catch (error) {
      logger.error('Error in getDeliveryPersonById:', error);
      throw error;
    }
  }

  /**
   * Update delivery person
   */
  async updateDeliveryPerson(personId, updateData, updatedBy) {
    try {
      const person = await DeliveryPerson.findById(personId);
      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }

      const allowedUpdates = ['vehicle', 'zone', 'serviceablePincodes', 'availability', 'bankDetails', 'maxConcurrentDeliveries'];
      allowedUpdates.forEach(field => {
        if (updateData[field] !== undefined) {
          person[field] = updateData[field];
        }
      });

      person.metadata.updatedBy = updatedBy;
      await person.save();

      return person;
    } catch (error) {
      logger.error('Error in updateDeliveryPerson:', error);
      throw error;
    }
  }

  /**
   * Update delivery person location
   */
  async updateLocation(personId, location) {
    try {
      const person = await DeliveryPerson.findById(personId);
      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }

      person.availability.currentLocation = {
        type: 'Point',
        coordinates: [location.lng, location.lat],
        updatedAt: new Date()
      };
      await person.save();

      // Update all active deliveries assigned to this person
      await Delivery.updateMany(
        {
          deliveryPerson: personId,
          status: { $in: ['out_for_delivery', 'in_transit'] }
        },
        {
          $set: {
            'tracking.currentLocation': {
              type: 'Point',
              coordinates: [location.lng, location.lat],
              updatedAt: new Date()
            }
          }
        }
      );

      return person;
    } catch (error) {
      logger.error('Error in updateLocation:', error);
      throw error;
    }
  }

  /**
   * Get available delivery persons
   */
  async getAvailableDeliveryPersons(pincode, limit = 10) {
    try {
      const persons = await DeliveryPerson.find({
        'availability.isAvailable': true,
        'availability.isOnDuty': true,
        serviceablePincodes: pincode
      })
        .populate('user', 'profile firstName lastName phone')
        .limit(limit)
        .lean();

      // Filter by current assignment count and shift timing
      const available = [];
      for (const person of persons) {
        if (await person.isAvailableForDelivery(pincode)) {
          available.push(person);
        }
      }

      return available;
    } catch (error) {
      logger.error('Error in getAvailableDeliveryPersons:', error);
      return [];
    }
  }

  /**
   * Verify delivery person document
   */
  async verifyDocument(personId, documentIndex, adminId, verificationData) {
    try {
      const { verified, notes } = verificationData;

      const person = await DeliveryPerson.findById(personId);
      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }

      if (!person.documents[documentIndex]) {
        throw new AppError('Document not found', 404);
      }

      person.documents[documentIndex].verified = verified;
      person.documents[documentIndex].verifiedAt = new Date();
      person.documents[documentIndex].verifiedBy = adminId;
      person.documents[documentIndex].notes = notes;

      // Check if all documents are verified
      const allVerified = person.documents.every(doc => doc.verified);
      if (allVerified && person.documents.length > 0) {
        person.status.verificationStatus = 'verified';
        person.status.isVerified = true;
      }

      await person.save();

      return person.documents[documentIndex];
    } catch (error) {
      logger.error('Error in verifyDocument:', error);
      throw error;
    }
  }

  // /**
  //  * Create delivery team
  //  */
  // async createDeliveryTeam(teamData, createdBy) {
  //   const session = await mongoose.startSession();
  //   session.startTransaction();

  //   try {
  //     const { name, teamLeadId, members, vehicle, zone, serviceablePincodes, equipment } = teamData;

  //     // Verify team lead exists
  //     const teamLead = await DeliveryPerson.findById(teamLeadId).session(session);
  //     if (!teamLead) {
  //       throw new AppError('Team lead not found', 404);
  //     }

  //     // Verify all members exist
  //     const memberDocs = [];
  //     for (const member of members) {
  //       const person = await DeliveryPerson.findById(member.deliveryPerson).session(session);
  //       if (!person) {
  //         throw new AppError(`Delivery person ${member.deliveryPerson} not found`, 404);
  //       }
  //       memberDocs.push({
  //         deliveryPerson: member.deliveryPerson,
  //         role: member.role,
  //         joinedAt: new Date()
  //       });
  //     }

  //     const team = await DeliveryTeam.create([{
  //       name,
  //       teamLead: teamLeadId,
  //       members: memberDocs,
  //       vehicle,
  //       zone,
  //       serviceablePincodes,
  //       equipment,
  //       metadata: {
  //         createdBy,
  //         createdAt: new Date()
  //       }
  //     }], { session });

  //     await session.commitTransaction();

  //     return team[0];
  //   } catch (error) {
  //     await session.abortTransaction();
  //     logger.error('Error in createDeliveryTeam:', error);
  //     throw error;
  //   } finally {
  //     session.endSession();
  //   }
  // }


  // src/services/delivery-personnel.service.js

  /**
   * Create delivery team
   */
  async createDeliveryTeam(teamData, createdBy) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { 
        name, 
        teamLeadId, 
        members, 
        vehicle, 
        zone, 
        serviceablePincodes, 
        equipment,
        maxConcurrentDeliveries 
      } = teamData;

      // Validate required fields
      if (!name) throw new AppError('Team name is required', 400);
      if (!teamLeadId) throw new AppError('Team lead ID is required', 400);

      // Check if team name already exists
      const existingTeam = await DeliveryTeam.findOne({ name }).session(session);
      if (existingTeam) {
        throw new AppError('Team name already exists', 409);
      }

      // Verify team lead exists and is a delivery person
      const teamLead = await DeliveryPerson.findById(teamLeadId).session(session);
      if (!teamLead) {
        throw new AppError('Team lead not found', 404);
      }

      // Process members - handle the frontend format
      const memberDocs = [];
      if (members && Array.isArray(members) && members.length > 0) {
        for (const member of members) {
          // Skip if no deliveryPerson ID
          if (!member.deliveryPerson) continue;
          
          // Check if this member is the team lead (avoid duplicate)
          if (member.deliveryPerson.toString() === teamLeadId) {
            continue;
          }
          
          // Verify the delivery person exists
          const person = await DeliveryPerson.findById(member.deliveryPerson).session(session);
          if (!person) {
            throw new AppError(`Delivery person ${member.deliveryPerson} not found`, 404);
          }
          
          memberDocs.push({
            deliveryPerson: member.deliveryPerson,
            role: member.role || 'helper',
            joinedAt: new Date(),
            isActive: true
          });
        }
      }

      // Generate team code
      const teamCount = await DeliveryTeam.countDocuments().session(session);
      const teamCode = `TEAM${(teamCount + 1).toString().padStart(4, '0')}`;

      // Process zone - handle array or string
      let zoneArray = zone;
      if (typeof zone === 'string') {
        zoneArray = [zone];
      }
      if (!zoneArray || zoneArray.length === 0) {
        zoneArray = ['north'];
      }

      // Process vehicle data
      const vehicleData = {
        type: vehicle?.type || 'van',
        number: vehicle?.number || '',
        model: vehicle?.model || '',
        capacity: vehicle?.capacity || 0,
        registrationNumber: vehicle?.registrationNumber || vehicle?.number || ''
      };

      // Process equipment
      const equipmentData = equipment || [];

      // Create the team with proper GeoJSON
      const team = new DeliveryTeam({
        name,
        teamCode,
        teamLead: teamLeadId,
        members: memberDocs,
        vehicle: vehicleData,
        zone: zoneArray,
        serviceablePincodes: serviceablePincodes || [],
        equipment: equipmentData,
        maxConcurrentDeliveries: maxConcurrentDeliveries || 10,
        availability: {
          isAvailable: true,
          isOnDuty: false,
          currentLocation: {
            type: 'Point',
            coordinates: [77.5946, 12.9716], // Default coordinates (longitude, latitude)
            updatedAt: new Date()
          },
          workingHours: {
            start: '09:00',
            end: '18:00'
          }
        },
        performance: {
          totalDeliveries: 0,
          completedDeliveries: 0,
          failedDeliveries: 0,
          averageRating: 0,
          onTimeRate: 0,
          totalDistance: 0,
          totalEarnings: 0
        },
        currentDeliveries: [],
        status: {
          isActive: true,
          isVerified: false
        },
        metadata: {
          createdBy,
          createdAt: new Date(),
          notes: ''
        }
      });

      // Save with session
      await team.save({ session });

      await session.commitTransaction();
      
      // Populate references before returning
      await team.populate([
        { path: 'teamLead', populate: { path: 'user', select: 'profile.email phone' } },
        { path: 'members.deliveryPerson', populate: { path: 'user', select: 'profile.email phone' } }
      ]);

      return team;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createDeliveryTeam:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get all delivery teams
   */
  // async getAllDeliveryTeams(page = 1, limit = 20, filters = {}) {
  //   try {
  //     const skip = (page - 1) * limit;

  //     const query = {};
  //     if (filters.status) query['status.isActive'] = filters.status === 'active';
  //     if (filters.zone) query.zone = filters.zone;
  //     if (filters.search) {
  //       query.name = new RegExp(filters.search, 'i');
  //     }

  //     const [teams, total] = await Promise.all([
  //       DeliveryTeam.find(query)
  //         .populate('teamLead', 'user employeeId vehicle')
  //         .populate('members.deliveryPerson', 'user employeeId')
  //         .sort({ createdAt: -1 })
  //         .skip(skip)
  //         .limit(limit)
  //         .lean(),
  //       DeliveryTeam.countDocuments(query)
  //     ]);

  //     return {
  //       teams,
  //       pagination: {
  //         page,
  //         limit,
  //         total,
  //         pages: Math.ceil(total / limit)
  //       }
  //     };
  //   } catch (error) {
  //     logger.error('Error in getAllDeliveryTeams:', error);
  //     throw error;
  //   }
  // }

  // src/services/delivery-personnel.service.js

async getAllDeliveryTeams(page = 1, limit = 20, filters = {}) {
  try {
    const skip = (page - 1) * limit;

    const query = {};
    if (filters.status) query['status.isActive'] = filters.status === 'active';
    if (filters.zone) query.zone = filters.zone;
    if (filters.search) {
      query.name = new RegExp(filters.search, 'i');
    }

    const [teams, total] = await Promise.all([
      DeliveryTeam.find(query)
        .populate({
          path: 'teamLead',
          populate: {
            path: 'user',
            select: 'profile.email phone role profile.avatar profile.firstName profile.lastName',
            options: { lean: true }
          }
        })
        .populate({
          path: 'members.deliveryPerson',
          populate: {
            path: 'user',
            select: 'profile.email phone role profile.avatar profile.firstName profile.lastName',
            options: { lean: true }
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DeliveryTeam.countDocuments(query)
    ]);

    // Transform the response to include full user details
    const transformedTeams = teams.map(team => ({
      ...team,
      teamLead: team.teamLead ? {
        ...team.teamLead,
        userDetails: team.teamLead.user ? {
          _id: team.teamLead.user._id,
          email: team.teamLead.user.email,
          phone: team.teamLead.user.phone,
          role: team.teamLead.user.role,
          name: `${team.teamLead.user.profile?.firstName || ''} ${team.teamLead.user.profile?.lastName || ''}`.trim(),
          avatar: team.teamLead.user.profile?.avatar
        } : null
      } : null,
      members: team.members.map(member => ({
        ...member,
        deliveryPerson: member.deliveryPerson ? {
          ...member.deliveryPerson,
          userDetails: member.deliveryPerson.user ? {
            _id: member.deliveryPerson.user._id,
            email: member.deliveryPerson.user.email,
            phone: member.deliveryPerson.user.phone,
            role: member.deliveryPerson.user.role,
            name: `${member.deliveryPerson.user.profile?.firstName || ''} ${member.deliveryPerson.user.profile?.lastName || ''}`.trim(),
            avatar: member.deliveryPerson.user.profile?.avatar
          } : null
        } : null
      }))
    }));

    return {
      teams: transformedTeams,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    logger.error('Error in getAllDeliveryTeams:', error);
    throw error;
  }
}

  /**
   * Get delivery team by ID
   */
  async getDeliveryTeamById(teamId) {
    try {
      const team = await DeliveryTeam.findById(teamId)
        .populate('teamLead', 'user employeeId vehicle performance')
        .populate('members.deliveryPerson', 'user employeeId vehicle performance')
        .lean();

      if (!team) {
        throw new AppError('Delivery team not found', 404);
      }

      return team;
    } catch (error) {
      logger.error('Error in getDeliveryTeamById:', error);
      throw error;
    }
  }

  /**
   * Update delivery team
   */
  async updateDeliveryTeam(teamId, updateData, updatedBy) {
    try {
      const team = await DeliveryTeam.findById(teamId);
      if (!team) {
        throw new AppError('Delivery team not found', 404);
      }

      const allowedUpdates = ['name', 'vehicle', 'zone', 'serviceablePincodes', 'equipment', 'availability'];
      allowedUpdates.forEach(field => {
        if (updateData[field] !== undefined) {
          team[field] = updateData[field];
        }
      });

      if (updateData.members) {
        // Verify new members exist
        for (const member of updateData.members) {
          const person = await DeliveryPerson.findById(member.deliveryPerson);
          if (!person) {
            throw new AppError(`Delivery person ${member.deliveryPerson} not found`, 404);
          }
        }
        team.members = updateData.members;
      }

      if (updateData.teamLead) {
        const newLead = await DeliveryPerson.findById(updateData.teamLead);
        if (!newLead) {
          throw new AppError('Team lead not found', 404);
        }
        team.teamLead = updateData.teamLead;
      }

      team.metadata.updatedBy = updatedBy;
      await team.save();

      return team;
    } catch (error) {
      logger.error('Error in updateDeliveryTeam:', error);
      throw error;
    }
  }

  /**
   * Get available delivery teams
   */
  async getAvailableDeliveryTeams(pincode, requiredMembers = 1) {
    try {
      const teams = await DeliveryTeam.find({
        'availability.isAvailable': true,
        'availability.isOnDuty': true,
        serviceablePincodes: pincode
      })
        .populate('teamLead', 'user employeeId')
        .populate('members.deliveryPerson', 'user employeeId')
        .lean();

      // Filter by availability and member count
      const available = [];
      for (const team of teams) {
        if (await team.isAvailableForDelivery(pincode)) {
          const activeMembers = team.members.filter(m => m.isActive !== false).length;
          if (activeMembers + 1 >= requiredMembers) { // +1 for team lead
            available.push(team);
          }
        }
      }

      return available;
    } catch (error) {
      logger.error('Error in getAvailableDeliveryTeams:', error);
      return [];
    }
  }

  /**
   * Update team location
   */
  async updateTeamLocation(teamId, location) {
    try {
      const team = await DeliveryTeam.findById(teamId);
      if (!team) {
        throw new AppError('Delivery team not found', 404);
      }

      team.availability.currentLocation = {
        type: 'Point',
        coordinates: [location.lng, location.lat],
        updatedAt: new Date()
      };
      await team.save();

      // Update all active deliveries assigned to this team
      await Delivery.updateMany(
        {
          deliveryTeam: { $in: team.members.map(m => m.deliveryPerson) },
          status: { $in: ['out_for_delivery', 'in_transit'] }
        },
        {
          $set: {
            'tracking.currentLocation': {
              type: 'Point',
              coordinates: [location.lng, location.lat],
              updatedAt: new Date()
            }
          }
        }
      );

      return team;
    } catch (error) {
      logger.error('Error in updateTeamLocation:', error);
      throw error;
    }
  }

  /**
   * Get team performance
   */
  async getTeamPerformance(teamId, period = 'month') {
    try {
      const team = await DeliveryTeam.findById(teamId);
      if (!team) {
        throw new AppError('Delivery team not found', 404);
      }

      const dateFilter = {};
      if (period === 'week') {
        dateFilter.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
      } else if (period === 'month') {
        dateFilter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
      } else if (period === 'quarter') {
        dateFilter.createdAt = { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) };
      }

      const deliveries = await Delivery.find({
        deliveryTeam: { $in: team.members.map(m => m.deliveryPerson) },
        ...dateFilter
      });

      const completedDeliveries = deliveries.filter(d => d.status === 'delivered');
      const onTimeDeliveries = completedDeliveries.filter(d => {
        const scheduled = new Date(d.schedule.scheduledDate);
        const actual = new Date(d.tracking?.actualArrival);
        return actual <= scheduled;
      });

      return {
        team: {
          name: team.name,
          teamCode: team.teamCode
        },
        period,
        metrics: {
          totalDeliveries: deliveries.length,
          completedDeliveries: completedDeliveries.length,
          failedDeliveries: deliveries.filter(d => d.status === 'failed').length,
          onTimeRate: completedDeliveries.length ? (onTimeDeliveries.length / completedDeliveries.length) * 100 : 0,
          totalDistance: team.performance.totalDistance,
          totalEarnings: team.performance.totalEarnings,
          averageRating: team.performance.averageRating
        },
        dailyBreakdown: this.getDailyBreakdown(deliveries)
      };
    } catch (error) {
      logger.error('Error in getTeamPerformance:', error);
      throw error;
    }
  }

  getDailyBreakdown(deliveries) {
    const daily = {};
    deliveries.forEach(d => {
      const date = d.createdAt.toISOString().split('T')[0];
      if (!daily[date]) {
        daily[date] = { total: 0, completed: 0, failed: 0 };
      }
      daily[date].total++;
      if (d.status === 'delivered') daily[date].completed++;
      if (d.status === 'failed') daily[date].failed++;
    });
    return Object.entries(daily).map(([date, data]) => ({ date, ...data }));
  }

  /**
   * Assign delivery to person or team
   */
  async assignDeliveryToPersonnel(deliveryId, assignData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        type,
        personId,
        teamId,
        notes,
        assignedBy,
        force = false,
        skipAvailabilityCheck = false,
        skipStatusCheck = false,
      } = assignData;

      const delivery = await Delivery.findById(deliveryId).session(session);
      if (!delivery) {
        throw new AppError('Delivery not found', 404);
      }

      const allowedStatuses = ['scheduled', 'batched'];
      if (!skipStatusCheck && !allowedStatuses.includes(delivery.status)) {
        throw new AppError(
          `Cannot assign delivery in status "${delivery.status}"`,
          400,
        );
      }

      const address = await mongoose.model('Address').findById(delivery.address).session(session);
      if (!address?.pincode) {
        throw new AppError('Delivery address or pincode missing', 400);
      }

      const existingPersonId = delivery.assignedDeliveryPerson || delivery.deliveryPerson;
      if (
        existingPersonId &&
        String(existingPersonId) !== String(personId || teamId) &&
        !force
      ) {
        throw new AppError(
          'Delivery already assigned. Pass force:true to reassign.',
          409,
        );
      }

      if (type === 'person') {
        const person = await DeliveryPerson.findById(personId).session(session);
        if (!person) {
          throw new AppError('Delivery person not found', 404);
        }
        console.log('Assigning to delivery person:', person)

        if (!skipAvailabilityCheck) {
          console.log('Checking availability for delivery person:', personId, 'Pincode:', address.pincode)
          const isAvailable = await person.isAvailableForDelivery(address.pincode);
          console.log('Availability result:', isAvailable)

          if (!isAvailable && !force) {
            throw new AppError('Delivery person is not available', 400);
          }
        }

        const alreadyTracked = person.currentAssignments.some(
          (a) => String(a.delivery) === String(deliveryId),
        );
        if (!alreadyTracked) {
          person.currentAssignments.push({
            delivery: deliveryId,
            assignedAt: new Date(),
            status: 'assigned',
          });
        }
        await person.save({ session });

        delivery.deliveryPerson = personId;
        delivery.assignedDeliveryPerson = personId;

      } else if (type === 'team') {
        const team = await DeliveryTeam.findById(teamId).session(session);
        if (!team) {
          throw new AppError('Delivery team not found', 404);
        }

        if (!skipAvailabilityCheck) {
          const isAvailable = await team.isAvailableForDelivery(address.pincode);
          if (!isAvailable && !force) {
            throw new AppError('Delivery team is not available', 400);
          }
        }

        delivery.deliveryPerson = team.teamLead;
        delivery.assignedDeliveryPerson = team.teamLead;
        delivery.deliveryTeam = team.members.map(m => m.deliveryPerson);
        delivery.vehicle = team.vehicle;

        team.currentDeliveries.push({
          delivery: deliveryId,
          assignedAt: new Date(),
          status: 'assigned'
        });
        await team.save({ session });
      }

      if (!delivery.tracking) {
        delivery.tracking = { timeline: [] };
      }
      if (!delivery.tracking.timeline) {
        delivery.tracking.timeline = [];
      }

      delivery.status = 'assigned';
      delivery.tracking.timeline.push({
        status: 'assigned',
        timestamp: new Date(),
        note: notes || `Assigned to ${type === 'person' ? 'delivery person' : 'team'}`,
        updatedBy: assignedBy,
      });

      await delivery.save({ session });
      await session.commitTransaction();

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in assignDeliveryToPersonnel:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get delivery person performance
   */
  async getPersonPerformance(personId, period = 'month') {
    try {
      const person = await DeliveryPerson.findById(personId)
        .populate('user', 'profile firstName lastName')
        .lean();

      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }

      const dateFilter = {};
      if (period === 'week') {
        dateFilter.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
      } else if (period === 'month') {
        dateFilter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
      }

      const deliveries = await Delivery.find({
        deliveryPerson: personId,
        ...dateFilter
      }).lean();

      const completedDeliveries = deliveries.filter(d => d.status === 'delivered');
      const onTimeDeliveries = completedDeliveries.filter(d => {
        const scheduled = new Date(d.schedule.scheduledDate);
        const actual = new Date(d.tracking?.actualArrival);
        return actual <= scheduled;
      });

      return {
        person: {
          name: person.user ? `${person.user.profile.firstName} ${person.user.profile.lastName}` : 'Unknown',
          employeeId: person.employeeId,
          vehicle: person.vehicle
        },
        period,
        metrics: {
          totalDeliveries: deliveries.length,
          completedDeliveries: completedDeliveries.length,
          failedDeliveries: deliveries.filter(d => d.status === 'failed').length,
          onTimeRate: completedDeliveries.length ? (onTimeDeliveries.length / completedDeliveries.length) * 100 : 0,
          averageRating: person.performance.averageRating,
          totalDistance: person.performance.totalDistance,
          totalEarnings: person.performance.totalEarnings,
          currentLoad: person.currentAssignments.filter(a => a.status === 'assigned' || a.status === 'started').length
        }
      };
    } catch (error) {
      logger.error('Error in getPersonPerformance:', error);
      throw error;
    }
  }

  /**
 * Get workload distribution across zones
 */
  async getWorkloadDistribution() {
    try {
      const distribution = await DeliveryPerson.aggregate([
        {
          $group: {
            _id: '$zone',
            totalPersonnel: { $sum: 1 },
            totalCapacity: { $sum: '$maxConcurrentDeliveries' },
            currentLoad: { $sum: { $size: '$currentAssignments' } },
            availablePersonnel: {
              $sum: {
                $cond: [
                  { $and: ['$availability.isAvailable', '$availability.isOnDuty'] },
                  1,
                  0
                ]
              }
            }
          }
        },
        {
          $project: {
            zone: '$_id',
            totalPersonnel: 1,
            totalCapacity: 1,
            currentLoad: 1,
            availablePersonnel: 1,
            utilizationRate: {
              $multiply: [
                { $divide: ['$currentLoad', { $max: ['$totalCapacity', 1] }] },
                100
              ]
            }
          }
        },
        { $sort: { utilizationRate: -1 } }
      ]);
      
      return distribution;
    } catch (error) {
      logger.error('Error in getWorkloadDistribution:', error);
      return [];
    }
  }

  /**
   * Count documents helper
   */
  async countDocuments(filter = {}) {
    return await DeliveryPerson.countDocuments(filter);
  }

  /**
   * Suspend delivery person
   */
  async suspendDeliveryPerson(personId, reason, suspendedBy) {
    const person = await DeliveryPerson.findById(personId);
    if (!person) {
      throw new AppError('Delivery person not found', 404);
    }
    
    person.status.isActive = false;
    person.status.verificationStatus = 'suspended';
    person.status.reason = reason;
    person.status.suspendedAt = new Date();
    person.status.suspendedBy = suspendedBy;
    
    await person.save();
    return person;
  }

  /**
   * Verify delivery person
   */
  async verifyDeliveryPerson(personId, verifiedBy) {
    const person = await DeliveryPerson.findById(personId);
    if (!person) {
      throw new AppError('Delivery person not found', 404);
    }
    
    person.status.isVerified = true;
    person.status.verificationStatus = 'verified';
    person.status.reason = null;
    
    await person.save();
    return person;
  }

  /**
   * Delete delivery team
   */
  async deleteDeliveryTeam(teamId) {
    const team = await DeliveryTeam.findById(teamId);
    if (!team) {
      throw new AppError('Delivery team not found', 404);
    }
    
    await team.deleteOne();
    return { success: true };
  }



  /**
   * Update delivery person location with history
   */
  async updateLocationWithHistory(personId, locationData) {
    try {
      const person = await DeliveryPerson.findById(personId);
      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }

      const { lat, lng, speed, battery, accuracy, address } = locationData;
      
      // Update current location
      person.availability.currentLocation = {
        type: 'Point',
        coordinates: [lng, lat],
        updatedAt: new Date(),
        speed,
        battery,
        accuracy
      };
      
      // Add to location history
      person.locationHistory = person.locationHistory || [];
      person.locationHistory.push({
        coordinates: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        timestamp: new Date(),
        speed,
        battery,
        accuracy,
        address
      });
      
      // Keep only last 1000 locations (adjust as needed)
      if (person.locationHistory.length > 1000) {
        person.locationHistory = person.locationHistory.slice(-1000);
      }
      
      await person.save();

      // Update active deliveries
      const activeDeliveries = await Delivery.find({
        $or: [{ deliveryPerson: personId }, { assignedDeliveryPerson: personId }],
        status: { $in: ['out_for_delivery', 'in_transit', 'reached'] },
      })
        .select('_id deliveryNumber rental')
        .populate('rental', 'user')
        .lean();

      await Delivery.updateMany(
        {
          _id: { $in: activeDeliveries.map((d) => d._id) },
        },
        {
          $set: {
            'tracking.currentLocation': {
              type: 'Point',
              coordinates: [lng, lat],
              updatedAt: new Date(),
              speed,
              battery,
              accuracy,
            },
          },
        },
      );

      eventEmitter.emit('delivery:partner-location-updated', {
        personId,
        userId: person.user,
        location: { lat, lng, speed, battery, accuracy },
        currentLocation: person.availability.currentLocation,
        activeDeliveryIds: activeDeliveries.map((d) => d._id.toString()),
        timestamp: new Date(),
      });

      for (const delivery of activeDeliveries) {
        eventEmitter.emit('delivery:location-updated', {
          deliveryId: delivery._id,
          deliveryNumber: delivery.deliveryNumber,
          location: { lat, lng, speed, battery, accuracy },
          customerUserId: delivery.rental?.user,
          personId,
        });
      }

      return person;
    } catch (error) {
      logger.error('Error updating location with history:', error);
      throw error;
    }
  }

  /**
   * Get location history for delivery person
   */
  async getLocationHistory(personId, startDate, endDate, limit = 100) {
    try {
      const person = await DeliveryPerson.findById(personId);
      if (!person) {
        throw new AppError('Delivery person not found', 404);
      }
      
      let history = person.locationHistory || [];
      
      if (startDate && endDate) {
        history = history.filter(h => 
          h.timestamp >= new Date(startDate) && 
          h.timestamp <= new Date(endDate)
        );
      }
      
      return {
        personId,
        totalPoints: history.length,
        history: history.slice(-limit),
        lastLocation: person.availability.currentLocation
      };
    } catch (error) {
      logger.error('Error getting location history:', error);
      throw error;
    }
  }
}

module.exports = new DeliveryPersonnelService();