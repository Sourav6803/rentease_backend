const SystemLog = require('../models/SystemLog.model');
const mongoose = require('mongoose');
const excel = require('exceljs');

class LogsService {
  async getLogs(type = 'activity', page = 1, limit = 50, filters = {}) {
    const skip = (page - 1) * limit;
    const query = { type };

    if (type === 'error') {
      if (filters.resolved !== undefined) query.resolved = filters.resolved === 'true';
      if (filters.statusCode) query.statusCode = parseInt(filters.statusCode);
      if (filters.route) query.route = new RegExp(filters.route, 'i');
      if (filters.method) query.method = new RegExp(filters.method, 'i');
    }

    if (type === 'audit') {
      if (filters.action) query.action = new RegExp(filters.action, 'i');
    }

    if (type === 'performance') {
      if (filters.endpoint) query.endpoint = new RegExp(filters.endpoint, 'i');
      if (filters.statusCode) query.statusCode = parseInt(filters.statusCode);
    }

    if (type === 'activity') {
      if (filters.severity) query['details.severity'] = filters.severity;
      if (filters.action) query.action = new RegExp(filters.action, 'i');
    }

    if (filters.dateFrom) query.timestamp = { ...query.timestamp, $gte: new Date(filters.dateFrom) };
    if (filters.dateTo) query.timestamp = { ...query.timestamp, $lte: new Date(filters.dateTo) };
    if (filters.user) query['user._id'] = new mongoose.Types.ObjectId(filters.user);

    const [logs, total] = await Promise.all([
      SystemLog.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      SystemLog.countDocuments(query)
    ]);

    return {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  async getLogStats() {
    const [typeCounts, uniqueUsersAgg, avgResponseTimeAgg, topEndpointsAgg] = await Promise.all([
      SystemLog.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]),
      SystemLog.distinct('user._id').then(ids => ids.filter(Boolean).length),
      SystemLog.aggregate([
        { $match: { type: 'performance', responseTime: { $exists: true, $ne: null } } },
        { $group: { _id: null, avgResponseTime: { $avg: '$responseTime' } } }
      ]),
      SystemLog.aggregate([
        { $match: { type: 'performance', endpoint: { $exists: true, $ne: null } } },
        { $group: { _id: '$endpoint', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    const typeStats = {};
    typeCounts.forEach(item => {
      typeStats[item._id] = item.count;
    });

    const severityCounts = {};
    await SystemLog.find({ type: 'activity', 'details.severity': { $exists: true } }).lean().then(logs => {
      logs.forEach(log => {
        const sev = log.details?.severity || 'info';
        severityCounts[sev] = (severityCounts[sev] || 0) + 1;
      });
    });

    return {
      typeCounts: typeStats,
      severityCounts,
      uniqueUsers: uniqueUsersAgg,
      averageResponseTime: Math.round(avgResponseTimeAgg[0]?.avgResponseTime || 0),
      topEndpoints: topEndpointsAgg.map(e => ({ endpoint: e._id, count: e.count }))
    };
  }

  async resolveError(id) {
    const log = await SystemLog.findById(id);
    if (!log) throw new AppError('Error log not found', 404);
    if (log.type !== 'error') throw new AppError('Log is not an error log', 400);

    log.resolved = true;
    await log.save();

    return { message: 'Error marked as resolved', log };
  }

  async exportLogs(type, format = 'json') {
    const logs = await SystemLog.find({ type }).sort({ timestamp: -1 }).lean();

    if (format === 'csv') {
      const workbook = new excel.Workbook();
      const sheet = workbook.addWorksheet('Logs');

      if (logs.length === 0) {
        sheet.addRow(['No logs found']);
      } else {
        sheet.columns = Object.keys(logs[0]).map(key => ({ header: key, key }));
        logs.forEach(log => sheet.addRow(Object.values(log)));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return { buffer, filename: `${type}-logs-${Date.now()}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    return { data: logs, filename: `${type}-logs-${Date.now()}.json`, contentType: 'application/json' };
  }

  async clearLogs(type) {
    const result = await SystemLog.deleteMany({ type });
    return { message: `${result.deletedCount} logs cleared`, deletedCount: result.deletedCount };
  }
}

module.exports = new LogsService();
