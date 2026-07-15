// // controllers/delivery-personnel.controller.js
// const DeliveryPersonnelService = require("../../services/delivery-personnel.service");
// const catchAsync = require("../../utils/catchAsync");
// const { ApiResponse } = require("../../utils/apiResponse");
// const { AppError } = require("../../utils/AppError");
// const logger = require("../../config/logger");
// const { DeliveryPerson, Delivery } = require("../../models");

// class DeliveryPersonnelController {
//   // ==================== DELIVERY PERSON METHODS ====================

//   /**
//    * Create delivery person
//    */
//   createDeliveryPerson = catchAsync(async (req, res) => {
//     const person = await DeliveryPersonnelService.createDeliveryPerson(
//       req.body,
//       req.admin._id,
//     );
//     return ApiResponse.success(
//       res,
//       201,
//       "Delivery person created successfully",
//       { person },
//     );
//   });

//   /**
//    * Get all delivery persons
//    */
//   getAllDeliveryPersons = catchAsync(async (req, res) => {
//     const { page = 1, limit = 20, ...filters } = req.query;
//     const result = await DeliveryPersonnelService.getAllDeliveryPersons(
//       parseInt(page),
//       parseInt(limit),
//       filters,
//     );
//     return ApiResponse.success(
//       res,
//       200,
//       "Delivery persons retrieved successfully",
//       result,
//     );
//   });

//   /**
//    * Get delivery person by ID
//    */
//   getDeliveryPersonById = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const person = await DeliveryPersonnelService.getDeliveryPersonById(id);
//     return ApiResponse.success(
//       res,
//       200,
//       "Delivery person retrieved successfully",
//       { person },
//     );
//   });

//   /**
//    * Update delivery person
//    */
//   updateDeliveryPerson = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const person = await DeliveryPersonnelService.updateDeliveryPerson(
//       id,
//       req.body,
//       req.user._id,
//     );
//     return ApiResponse.success(
//       res,
//       200,
//       "Delivery person updated successfully",
//       { person },
//     );
//   });

//   /**
//    * Update delivery person location
//    */
//   updateLocation = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const { location } = req.body;
//     const person = await DeliveryPersonnelService.updateLocation(id, location);
//     return ApiResponse.success(res, 200, "Location updated successfully", {
//       person,
//     });
//   });

//   /**
//    * Get available delivery persons
//    */
//   getAvailableDeliveryPersons = catchAsync(async (req, res) => {
//     const { pincode, limit = 10 } = req.query;
//     if (!pincode) {
//       throw new AppError("Pincode is required", 400);
//     }
//     const persons = await DeliveryPersonnelService.getAvailableDeliveryPersons(
//       pincode,
//       parseInt(limit),
//     );
//     return ApiResponse.success(
//       res,
//       200,
//       "Available delivery persons retrieved",
//       { persons },
//     );
//   });

//   /**
//    * Verify delivery person document
//    */
//   verifyDocument = catchAsync(async (req, res) => {
//     const { id, documentIndex } = req.params;
//     const document = await DeliveryPersonnelService.verifyDocument(
//       id,
//       parseInt(documentIndex),
//       req.user._id,
//       req.body,
//     );
//     return ApiResponse.success(res, 200, "Document verified successfully", {
//       document,
//     });
//   });

//   /**
//    * Get delivery person performance
//    */
//   getPersonPerformance = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const { period = "month" } = req.query;
//     const performance = await DeliveryPersonnelService.getPersonPerformance(
//       id,
//       period,
//     );
//     return ApiResponse.success(
//       res,
//       200,
//       "Performance retrieved successfully",
//       performance,
//     );
//   });

//   // ==================== DELIVERY TEAM METHODS ====================

//   /**
//    * Create delivery team
//    */
//   createDeliveryTeam = catchAsync(async (req, res) => {
//     const team = await DeliveryPersonnelService.createDeliveryTeam(
//       req.body,
//       req.admin._id,
//     );
//     return ApiResponse.success(res, 201, "Delivery team created successfully", {
//       team,
//     });
//   });

//   /**
//    * Get all delivery teams
//    */
//   getAllDeliveryTeams = catchAsync(async (req, res) => {
//     const { page = 1, limit = 20, ...filters } = req.query;
//     const result = await DeliveryPersonnelService.getAllDeliveryTeams(
//       parseInt(page),
//       parseInt(limit),
//       filters,
//     );
//     return ApiResponse.success(
//       res,
//       200,
//       "Delivery teams retrieved successfully",
//       result,
//     );
//   });

//   /**
//    * Get delivery team by ID
//    */
//   getDeliveryTeamById = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const team = await DeliveryPersonnelService.getDeliveryTeamById(id);
//     return ApiResponse.success(
//       res,
//       200,
//       "Delivery team retrieved successfully",
//       { team },
//     );
//   });

//   /**
//    * Update delivery team
//    */
//   updateDeliveryTeam = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const team = await DeliveryPersonnelService.updateDeliveryTeam(
//       id,
//       req.body,
//       req.user._id,
//     );
//     return ApiResponse.success(res, 200, "Delivery team updated successfully", {
//       team,
//     });
//   });

//   /**
//    * Get available delivery teams
//    */
//   getAvailableDeliveryTeams = catchAsync(async (req, res) => {
//     const { pincode, requiredMembers = 1 } = req.query;
//     if (!pincode) {
//       throw new AppError("Pincode is required", 400);
//     }
//     const teams = await DeliveryPersonnelService.getAvailableDeliveryTeams(
//       pincode,
//       parseInt(requiredMembers),
//     );
//     return ApiResponse.success(res, 200, "Available delivery teams retrieved", {
//       teams,
//     });
//   });

//   /**
//    * Update team location
//    */
//   updateTeamLocation = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const { location } = req.body;
//     const team = await DeliveryPersonnelService.updateTeamLocation(
//       id,
//       location,
//     );
//     return ApiResponse.success(res, 200, "Team location updated successfully", {
//       team,
//     });
//   });

//   /**
//    * Get team performance
//    */
//   getTeamPerformance = catchAsync(async (req, res) => {
//     const { id } = req.params;
//     const { period = "month" } = req.query;
//     const performance = await DeliveryPersonnelService.getTeamPerformance(
//       id,
//       period,
//     );
//     return ApiResponse.success(
//       res,
//       200,
//       "Team performance retrieved successfully",
//       performance,
//     );
//   });

//   // ==================== ASSIGNMENT METHODS ====================

//   /**
//    * Assign delivery to person or team
//    */
//   assignDeliveryToPersonnel = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
//     const assignment = await DeliveryPersonnelService.assignDeliveryToPersonnel(
//       deliveryId,
//       {
//         ...req.body,
//         assignedBy: req.user._id,
//       },
//     );
//     return ApiResponse.success(res, 200, "Delivery assigned successfully", {
//       assignment,
//     });
//   });

//   // Add to delivery-personnel.controller.js

//   /**
//    * Get delivery personnel dashboard analytics
//    */
//   getDashboardAnalytics = catchAsync(async (req, res) => {
//     const { period = "month" } = req.query;

//     const dateFilter = {};
//     if (period === "week") {
//       dateFilter.startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
//     } else if (period === "month") {
//       dateFilter.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
//     } else if (period === "quarter") {
//       dateFilter.startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
//     }

//     const [
//       totalPersons,
//       activePersons,
//       onDutyPersons,
//       verifiedPersons,
//       avgPerformance,
//       topPerformers,
//       recentActivities,
//     ] = await Promise.all([
//       DeliveryPerson.countDocuments(),
//       DeliveryPerson.countDocuments({ "availability.isAvailable": true }),
//       DeliveryPerson.countDocuments({ "availability.isOnDuty": true }),
//       DeliveryPerson.countDocuments({
//         "status.verificationStatus": "verified",
//       }),
//       this.getAveragePerformanceMetrics(dateFilter),
//       this.getTopPerformers(5),
//       this.getRecentActivities(10),
//     ]);

//     return ApiResponse.success(res, 200, "Dashboard analytics retrieved", {
//       summary: {
//         totalPersons,
//         activePersons,
//         onDutyPersons,
//         verifiedPersons,
//         utilizationRate: totalPersons
//           ? (activePersons / totalPersons) * 100
//           : 0,
//       },
//       averageMetrics: avgPerformance,
//       topPerformers,
//       recentActivities,
//       period,
//     });
//   });

//   /**
//    * Get average performance metrics across all delivery persons
//    */
//   getAveragePerformanceMetrics = async (dateFilter) => {
//     const matchStage = dateFilter.startDate
//       ? {
//           createdAt: { $gte: dateFilter.startDate },
//         }
//       : {};

//     const result = await DeliveryPerson.aggregate([
//       { $match: matchStage },
//       {
//         $group: {
//           _id: null,
//           avgTotalDeliveries: { $avg: "$performance.totalDeliveries" },
//           avgCompletedDeliveries: { $avg: "$performance.completedDeliveries" },
//           avgRating: { $avg: "$performance.averageRating" },
//           avgOnTimeRate: { $avg: "$performance.onTimeRate" },
//           avgDistance: { $avg: "$performance.totalDistance" },
//           avgEarnings: { $avg: "$performance.totalEarnings" },
//         },
//       },
//     ]);

//     return result[0] || {};
//   };

//   /**
//    * Get top performing delivery persons
//    */
//   getTopPerformers = async (limit = 5) => {
//     return await DeliveryPerson.find({
//       "performance.completedDeliveries": { $gt: 0 },
//     })
//       .populate("user", "profile firstName profile lastName")
//       .sort({
//         "performance.completedDeliveries": -1,
//         "performance.averageRating": -1,
//         "performance.onTimeRate": -1,
//       })
//       .limit(limit)
//       .lean();
//   };

//   /**
//    * Get recent delivery activities
//    */
//   getRecentActivities = async (limit = 10) => {
//     const deliveries = await Delivery.find()
//       .sort({ createdAt: -1 })
//       .limit(limit)
//       .populate("deliveryPerson", "user")
//       .lean();

//     return deliveries.map((d) => ({
//       deliveryId: d._id,
//       deliveryNumber: d.deliveryNumber,
//       status: d.status,
//       type: d.type,
//       deliveryPerson: d.deliveryPerson,
//       scheduledDate: d.schedule.scheduledDate,
//       actualArrival: d.tracking?.actualArrival,
//       createdAt: d.createdAt,
//     }));
//   };

//   /**
//    * Get delivery person performance comparison
//    */
//   getPerformanceComparison = catchAsync(async (req, res) => {
//     const { personIds, period = "month" } = req.query;

//     if (!personIds) {
//       throw new AppError("Person IDs required", 400);
//     }

//     const ids = personIds.split(",");
//     const performances = [];

//     for (const id of ids) {
//       const performance = await DeliveryPersonnelService.getPersonPerformance(
//         id,
//         period,
//       );
//       performances.push(performance);
//     }

//     return ApiResponse.success(res, 200, "Performance comparison retrieved", {
//       comparison: performances,
//       period,
//     });
//   });

//   /**
//    * Get delivery heatmap data (geographical distribution)
//    */
//   getDeliveryHeatmap = catchAsync(async (req, res) => {
//     const { startDate, endDate } = req.query;

//     const matchStage = {};
//     if (startDate && endDate) {
//       matchStage.createdAt = {
//         $gte: new Date(startDate),
//         $lte: new Date(endDate),
//       };
//     }

//     const heatmapData = await Delivery.aggregate([
//       { $match: matchStage },
//       { $unwind: "$tracking.timeline" },
//       {
//         $match: {
//           "tracking.timeline.location.coordinates": {
//             $exists: true,
//             $ne: null,
//           },
//         },
//       },
//       {
//         $group: {
//           _id: {
//             lat: {
//               $arrayElemAt: ["$tracking.timeline.location.coordinates", 1],
//             },
//             lng: {
//               $arrayElemAt: ["$tracking.timeline.location.coordinates", 0],
//             },
//           },
//           count: { $sum: 1 },
//         },
//       },
//       { $limit: 1000 },
//     ]);

//     return ApiResponse.success(res, 200, "Heatmap data retrieved", {
//       points: heatmapData,
//       totalPoints: heatmapData.length,
//     });
//   });

//   /**
//    * Get efficiency metrics
//    */
//   getEfficiencyMetrics = catchAsync(async (req, res) => {
//     const { period = "month" } = req.query;

//     const dateFilter = {};
//     if (period === "week") {
//       dateFilter.startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
//     } else if (period === "month") {
//       dateFilter.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
//     }

//     const matchStage = dateFilter.startDate
//       ? {
//           createdAt: { $gte: dateFilter.startDate },
//         }
//       : {};

//     const efficiency = await Delivery.aggregate([
//       { $match: matchStage },
//       {
//         $facet: {
//           averageDeliveryTime: [
//             {
//               $match: { "tracking.actualArrival": { $exists: true } },
//             },
//             {
//               $project: {
//                 deliveryTime: {
//                   $subtract: [
//                     "$tracking.actualArrival",
//                     "$schedule.scheduledDate",
//                   ],
//                 },
//               },
//             },
//             {
//               $group: {
//                 _id: null,
//                 avgMinutes: { $avg: { $divide: ["$deliveryTime", 60000] } },
//               },
//             },
//           ],
//           onTimePercentage: [
//             {
//               $match: {
//                 status: "delivered",
//                 "tracking.actualArrival": { $exists: true },
//               },
//             },
//             {
//               $project: {
//                 isOnTime: {
//                   $lte: ["$tracking.actualArrival", "$schedule.scheduledDate"],
//                 },
//               },
//             },
//             {
//               $group: {
//                 _id: null,
//                 onTimeCount: { $sum: { $cond: ["$isOnTime", 1, 0] } },
//                 totalCount: { $sum: 1 },
//               },
//             },
//             {
//               $project: {
//                 percentage: {
//                   $multiply: [
//                     { $divide: ["$onTimeCount", "$totalCount"] },
//                     100,
//                   ],
//                 },
//               },
//             },
//           ],
//           successRate: [
//             {
//               $group: {
//                 _id: null,
//                 delivered: {
//                   $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
//                 },
//                 failed: {
//                   $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
//                 },
//                 total: { $sum: 1 },
//               },
//             },
//             {
//               $project: {
//                 successRate: {
//                   $multiply: [{ $divide: ["$delivered", "$total"] }, 100],
//                 },
//                 failureRate: {
//                   $multiply: [{ $divide: ["$failed", "$total"] }, 100],
//                 },
//               },
//             },
//           ],
//           averageDistancePerDelivery: [
//             {
//               $group: {
//                 _id: null,
//                 avgDistance: { $avg: "$route.distance" },
//               },
//             },
//           ],
//         },
//       },
//     ]);

//     return ApiResponse.success(res, 200, "Efficiency metrics retrieved", {
//       period,
//       metrics: {
//         averageDeliveryTimeMinutes:
//           efficiency[0]?.averageDeliveryTime[0]?.avgMinutes || 0,
//         onTimeDeliveryPercentage:
//           efficiency[0]?.onTimePercentage[0]?.percentage || 0,
//         successRate: efficiency[0]?.successRate[0]?.successRate || 0,
//         failureRate: efficiency[0]?.successRate[0]?.failureRate || 0,
//         averageDistancePerDelivery:
//           efficiency[0]?.averageDistancePerDelivery[0]?.avgDistance || 0,
//       },
//     });
//   });

//   /**
//    * Export delivery person report
//    */
//   exportDeliveryPersonReport = catchAsync(async (req, res) => {
//     const { format = "csv", period = "month", personId } = req.query;

//     let persons = [];
//     if (personId) {
//       const person = await DeliveryPersonnelService.getPersonPerformance(
//         personId,
//         period,
//       );
//       persons = [person];
//     } else {
//       const result = await DeliveryPersonnelService.getAllDeliveryPersons(
//         1,
//         1000,
//         {},
//       );
//       persons = result.persons;
//     }

//     if (format === "csv") {
//       const csvData = persons.map((p) => ({
//         "Employee ID": p.employeeId,
//         Name: p.user?.profile?.firstName + " " + p.user?.profile?.lastName,
//         Email: p.user?.email,
//         Phone: p.user?.phone,
//         "Vehicle Type": p.vehicle?.type,
//         Zone: p.zone,
//         "Total Deliveries": p.performance?.totalDeliveries,
//         "Completed Deliveries": p.performance?.completedDeliveries,
//         "Failed Deliveries": p.performance?.failedDeliveries,
//         "On-Time Rate": `${p.performance?.onTimeRate}%`,
//         "Average Rating": p.performance?.averageRating,
//         "Total Distance (km)": p.performance?.totalDistance,
//         "Total Earnings": p.performance?.totalEarnings,
//         Status: p.status?.isActive ? "Active" : "Inactive",
//         Verification: p.status?.verificationStatus,
//       }));

//       const { Parser } = require("json2csv");
//       const parser = new Parser();
//       const csv = parser.parse(csvData);

//       res.setHeader("Content-Type", "text/csv");
//       res.setHeader(
//         "Content-Disposition",
//         `attachment; filename=delivery-personnel-report-${Date.now()}.csv`,
//       );
//       return res.send(csv);
//     }

//     return ApiResponse.success(res, 200, "Report generated", {
//       persons,
//       period,
//     });
//   });
// }

// module.exports = new DeliveryPersonnelController();






// src/api/controllers/delivery-personnel.controller.js
const DeliveryPersonnelService = require('../../services/delivery-personnel.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const Delivery = require('../../models/Delivery.model');

class DeliveryPersonnelController {
  // ==================== DELIVERY PERSON METHODS ====================

  /**
   * Create delivery person
   */
  createDeliveryPerson = catchAsync(async (req, res) => {
    const person = await DeliveryPersonnelService.createDeliveryPerson(req.body, req.user._id);
    return ApiResponse.success(res, 201, 'Delivery person created successfully', { person });
  });

  /**
   * Get all delivery persons
   */
  getAllDeliveryPersons = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    const result = await DeliveryPersonnelService.getAllDeliveryPersons(
      parseInt(page),
      parseInt(limit),
      filters
    );
    return ApiResponse.success(res, 200, 'Delivery persons retrieved successfully', result);
  });

  /**
   * Get delivery person by ID
   */
  getDeliveryPersonById = catchAsync(async (req, res) => {
    const { id } = req.params;
    const person = await DeliveryPersonnelService.getDeliveryPersonById(id);
    return ApiResponse.success(res, 200, 'Delivery person retrieved successfully', { person });
  });

  /**
   * Update delivery person
   */
  updateDeliveryPerson = catchAsync(async (req, res) => {
    const { id } = req.params;
    const person = await DeliveryPersonnelService.updateDeliveryPerson(id, req.body, req.user._id);
    return ApiResponse.success(res, 200, 'Delivery person updated successfully', { person });
  });

  /**
   * Update delivery person location
   */
  updateLocation = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { location } = req.body;
    const person = await DeliveryPersonnelService.updateLocation(id, location);
    return ApiResponse.success(res, 200, 'Location updated successfully', { person });
  });

  /**
   * Get available delivery persons
   */
  getAvailableDeliveryPersons = catchAsync(async (req, res) => {
    const { pincode, limit = 10 } = req.query;
    if (!pincode) {
      throw new AppError('Pincode is required', 400);
    }
    const persons = await DeliveryPersonnelService.getAvailableDeliveryPersons(pincode, parseInt(limit));
    return ApiResponse.success(res, 200, 'Available delivery persons retrieved', { persons });
  });

  /**
   * Verify delivery person document
   */
  verifyDocument = catchAsync(async (req, res) => {
    const { id, documentIndex } = req.params;
    const document = await DeliveryPersonnelService.verifyDocument(
      id,
      parseInt(documentIndex),
      req.user._id,
      req.body
    );
    return ApiResponse.success(res, 200, 'Document verified successfully', { document });
  });

  /**
   * Get delivery person performance
   */
  getPersonPerformance = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { period = 'month' } = req.query;
    const performance = await DeliveryPersonnelService.getPersonPerformance(id, period);
    return ApiResponse.success(res, 200, 'Performance retrieved successfully', performance);
  });

  /**
   * Get location history
   */
  getLocationHistory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate, limit = 100 } = req.query;
    
    const history = await DeliveryPersonnelService.getLocationHistory(id, startDate, endDate, parseInt(limit));
    return ApiResponse.success(res, 200, 'Location history retrieved', history);
  });

  /**
   * Suspend delivery person
   */
  suspendDeliveryPerson = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    const person = await DeliveryPersonnelService.suspendDeliveryPerson(id, reason, req.user._id);
    return ApiResponse.success(res, 200, 'Delivery person suspended successfully', { person });
  });

  /**
   * Verify delivery person
   */
  verifyDeliveryPerson = catchAsync(async (req, res) => {
    const { id } = req.params;
    const person = await DeliveryPersonnelService.verifyDeliveryPerson(id, req.user._id);
    return ApiResponse.success(res, 200, 'Delivery person verified successfully', { person });
  });

  // ==================== DELIVERY TEAM METHODS ====================

  /**
   * Create delivery team
   */
  createDeliveryTeam = catchAsync(async (req, res) => {
    const team = await DeliveryPersonnelService.createDeliveryTeam(req.body, req.user._id);
    return ApiResponse.success(res, 201, 'Delivery team created successfully', { team });
  });

  /**
   * Get all delivery teams
   */
  getAllDeliveryTeams = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    const result = await DeliveryPersonnelService.getAllDeliveryTeams(
      parseInt(page),
      parseInt(limit),
      filters
    );
    return ApiResponse.success(res, 200, 'Delivery teams retrieved successfully', result);
  });

  /**
   * Get delivery team by ID
   */
  getDeliveryTeamById = catchAsync(async (req, res) => {
    const { id } = req.params;
    const team = await DeliveryPersonnelService.getDeliveryTeamById(id);
    return ApiResponse.success(res, 200, 'Delivery team retrieved successfully', { team });
  });

  /**
   * Update delivery team
   */
  updateDeliveryTeam = catchAsync(async (req, res) => {
    const { id } = req.params;
    const team = await DeliveryPersonnelService.updateDeliveryTeam(id, req.body, req.user._id);
    return ApiResponse.success(res, 200, 'Delivery team updated successfully', { team });
  });

  /**
   * Delete delivery team
   */
  deleteDeliveryTeam = catchAsync(async (req, res) => {
    const { id } = req.params;
    await DeliveryPersonnelService.deleteDeliveryTeam(id);
    return ApiResponse.success(res, 200, 'Delivery team deleted successfully');
  });

  /**
   * Get available delivery teams
   */
  getAvailableDeliveryTeams = catchAsync(async (req, res) => {
    const { pincode, requiredMembers = 1 } = req.query;
    if (!pincode) {
      throw new AppError('Pincode is required', 400);
    }
    const teams = await DeliveryPersonnelService.getAvailableDeliveryTeams(pincode, parseInt(requiredMembers));
    return ApiResponse.success(res, 200, 'Available delivery teams retrieved', { teams });
  });

  /**
   * Update team location
   */
  updateTeamLocation = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { location } = req.body;
    const team = await DeliveryPersonnelService.updateTeamLocation(id, location);
    return ApiResponse.success(res, 200, 'Team location updated successfully', { team });
  });

  /**
   * Get team performance
   */
  getTeamPerformance = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { period = 'month' } = req.query;
    const performance = await DeliveryPersonnelService.getTeamPerformance(id, period);
    return ApiResponse.success(res, 200, 'Team performance retrieved successfully', performance);
  });

  // ==================== ASSIGNMENT METHODS ====================

  /**
   * Assign delivery to person or team
   */
  assignDeliveryToPersonnel = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const assignment = await DeliveryPersonnelService.assignDeliveryToPersonnel(deliveryId, {
      ...req.body,
      assignedBy: req.user._id
    });
    return ApiResponse.success(res, 200, 'Delivery assigned successfully', { assignment });
  });

  /**
   * Bulk assign deliveries
   */
  bulkAssignDeliveries = catchAsync(async (req, res) => {
    const { assignments } = req.body;
    const results = [];
    
    for (const assignment of assignments) {
      try {
        const result = await DeliveryPersonnelService.assignDeliveryToPersonnel(assignment.deliveryId, {
          type: 'person',
          personId: assignment.personId,
          assignedBy: req.user._id
        });
        results.push({ deliveryId: assignment.deliveryId, success: true, result });
      } catch (error) {
        results.push({ deliveryId: assignment.deliveryId, success: false, error: error.message });
      }
    }
    
    return ApiResponse.success(res, 200, 'Bulk assignment completed', {
      total: assignments.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  });

  // ==================== ANALYTICS METHODS ====================

  /**
   * Get dashboard analytics
   */
  getDashboardAnalytics = catchAsync(async (req, res) => {
    const { period = 'month' } = req.query;
    
    const dateFilter = {};
    if (period === 'week') {
      dateFilter.startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      dateFilter.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'quarter') {
      dateFilter.startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    }

    const [totalPersons, activePersons, onDutyPersons, verifiedPersons] = await Promise.all([
      DeliveryPersonnelService.countDocuments ? DeliveryPersonnelService.countDocuments() : 0,
      DeliveryPersonnelService.countDocuments({ 'availability.isAvailable': true }) || 0,
      DeliveryPersonnelService.countDocuments({ 'availability.isOnDuty': true }) || 0,
      DeliveryPersonnelService.countDocuments({ 'status.verificationStatus': 'verified' }) || 0
    ]);

    return ApiResponse.success(res, 200, 'Dashboard analytics retrieved', {
      summary: {
        totalPersons,
        activePersons,
        onDutyPersons,
        verifiedPersons,
        utilizationRate: totalPersons ? ((activePersons / totalPersons) * 100).toFixed(1) : 0
      },
      period
    });
  });

  /**
   * Get performance comparison
   */
  getPerformanceComparison = catchAsync(async (req, res) => {
    const { personIds, period = 'month' } = req.query;
    
    if (!personIds) {
      throw new AppError('Person IDs required', 400);
    }
    
    const ids = personIds.split(',');
    const performances = [];
    
    for (const id of ids) {
      try {
        const performance = await DeliveryPersonnelService.getPersonPerformance(id, period);
        performances.push(performance);
      } catch (error) {
        performances.push({ id, error: 'Failed to fetch performance' });
      }
    }
    
    return ApiResponse.success(res, 200, 'Performance comparison retrieved', {
      comparison: performances,
      period
    });
  });

  /**
   * Get delivery heatmap data
   */
  getDeliveryHeatmap = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    const matchStage = {};
    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // This would aggregate delivery locations
    const heatmapData = await Delivery.aggregate([
      { $match: matchStage },
      { $unwind: '$tracking.timeline' },
      {
        $match: {
          'tracking.timeline.location.coordinates': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            lat: { $arrayElemAt: ['$tracking.timeline.location.coordinates', 1] },
            lng: { $arrayElemAt: ['$tracking.timeline.location.coordinates', 0] }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          lat: '$_id.lat',
          lng: '$_id.lng',
          intensity: '$count'
        }
      },
      { $limit: 1000 }
    ]);
    
    return ApiResponse.success(res, 200, 'Heatmap data retrieved', {
      points: heatmapData,
      totalPoints: heatmapData.length
    });
  });

  /**
   * Get efficiency metrics
   */
  getEfficiencyMetrics = catchAsync(async (req, res) => {
    const { period = 'month' } = req.query;
    
    const dateFilter = {};
    if (period === 'week') {
      dateFilter.startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      dateFilter.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'quarter') {
      dateFilter.startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    }
    
    const matchStage = dateFilter.startDate ? {
      createdAt: { $gte: dateFilter.startDate }
    } : {};
    
    const efficiency = await Delivery.aggregate([
      { $match: matchStage },
      {
        $facet: {
          averageDeliveryTime: [
            {
              $match: { 'tracking.actualArrival': { $exists: true } }
            },
            {
              $project: {
                deliveryTime: {
                  $subtract: ['$tracking.actualArrival', '$schedule.scheduledDate']
                }
              }
            },
            {
              $group: {
                _id: null,
                avgMinutes: { $avg: { $divide: ['$deliveryTime', 60000] } }
              }
            }
          ],
          successRate: [
            {
              $group: {
                _id: null,
                delivered: {
                  $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                },
                total: { $sum: 1 }
              }
            },
            {
              $project: {
                successRate: {
                  $multiply: [{ $divide: ['$delivered', '$total'] }, 100]
                }
              }
            }
          ]
        }
      }
    ]);
    
    return ApiResponse.success(res, 200, 'Efficiency metrics retrieved', {
      period,
      metrics: {
        averageDeliveryTimeMinutes: Math.round(efficiency[0]?.averageDeliveryTime[0]?.avgMinutes || 0),
        successRate: Math.round(efficiency[0]?.successRate[0]?.successRate || 0)
      }
    });
  });

  /**
   * Export delivery person report
   */
  exportDeliveryPersonReport = catchAsync(async (req, res) => {
    const { format = 'csv', period = 'month', personId } = req.query;
    
    let persons = [];
    if (personId) {
      const person = await DeliveryPersonnelService.getDeliveryPersonById(personId);
      if (person) persons = [person];
    } else {
      const result = await DeliveryPersonnelService.getAllDeliveryPersons(1, 1000, {});
      persons = result.persons;
    }
    
    if (format === 'csv') {
      const csvData = persons.map(p => ({
        'Employee ID': p.employeeId,
        'Name': p.user?.profile?.firstName + ' ' + p.user?.profile?.lastName || 'Unknown',
        'Email': p.user?.email || 'N/A',
        'Phone': p.user?.phone || 'N/A',
        'Vehicle Type': p.vehicle?.type || 'N/A',
        'Zone': p.zone || 'All',
        'Total Deliveries': p.performance?.totalDeliveries || 0,
        'Completed Deliveries': p.performance?.completedDeliveries || 0,
        'Failed Deliveries': p.performance?.failedDeliveries || 0,
        'On-Time Rate': `${p.performance?.onTimeRate || 0}%`,
        'Average Rating': (p.performance?.averageRating || 0).toFixed(1),
        'Total Earnings': p.performance?.totalEarnings || 0,
        'Status': p.status?.isActive ? 'Active' : 'Inactive'
      }));
      
      const json2csv = require('json2csv').Parser;
      const parser = new json2csv();
      const csv = parser.parse(csvData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=delivery-personnel-report-${Date.now()}.csv`);
      return res.send(csv);
    }
    
    return ApiResponse.success(res, 200, 'Report generated', { persons, period });
  });

  /**
   * Get workload distribution
   */
  getWorkloadDistribution = catchAsync(async (req, res) => {
    // This method was missing - adding it now
    const workload = await DeliveryPersonnelService.getWorkloadDistribution();
    return ApiResponse.success(res, 200, 'Workload distribution retrieved', { workload });
  });
}

module.exports = new DeliveryPersonnelController();