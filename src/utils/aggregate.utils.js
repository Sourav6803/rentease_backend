/**
 * MongoDB Aggregation Pipeline Utilities
 */
class AggregateUtils {
  /**
   * Create lookup pipeline
   */
  lookup({
    from,
    localField,
    foreignField = '_id',
    as = null,
    pipeline = [],
  }) {
    return {
      $lookup: {
        from,
        localField,
        foreignField,
        as: as || localField,
        pipeline,
      },
    };
  }

  /**
   * Create unwind pipeline
   */
  unwind(field, options = {}) {
    return {
      $unwind: {
        path: `$${field}`,
        preserveNullAndEmptyArrays: options.preserveNull || false,
      },
    };
  }

  /**
   * Create match pipeline
   */
  match(conditions) {
    return { $match: conditions };
  }

  /**
   * Create group pipeline
   */
  group({
    id = null,
    fields = {},
    push = [],
    addToSet = [],
    first = [],
    last = [],
  }) {
    const groupStage = {
      $group: {
        _id: id,
      },
    };

    // Add accumulator fields
    Object.entries(fields).forEach(([key, value]) => {
      if (value.$sum !== undefined) {
        groupStage.$group[key] = { $sum: value.$sum };
      } else if (value.$avg !== undefined) {
        groupStage.$group[key] = { $avg: value.$avg };
      } else if (value.$min !== undefined) {
        groupStage.$group[key] = { $min: value.$min };
      } else if (value.$max !== undefined) {
        groupStage.$group[key] = { $max: value.$max };
      }
    });

    // Add push accumulators
    push.forEach(item => {
      groupStage.$group[item.as] = { $push: item.field };
    });

    // Add addToSet accumulators
    addToSet.forEach(item => {
      groupStage.$group[item.as] = { $addToSet: item.field };
    });

    // Add first accumulators
    first.forEach(item => {
      groupStage.$group[item.as] = { $first: item.field };
    });

    // Add last accumulators
    last.forEach(item => {
      groupStage.$group[item.as] = { $last: item.field };
    });

    return groupStage;
  }

  /**
   * Create sort pipeline
   */
  sort(sortBy) {
    return { $sort: sortBy };
  }

  /**
   * Create limit pipeline
   */
  limit(limit) {
    return { $limit: limit };
  }

  /**
   * Create skip pipeline
   */
  skip(skip) {
    return { $skip: skip };
  }

  /**
   * Create project pipeline
   */
  project(fields) {
    return { $project: fields };
  }

  /**
   * Create addFields pipeline
   */
  addFields(fields) {
    return { $addFields: fields };
  }

  /**
   * Create facet pipeline
   */
  facet(facets) {
    return { $facet: facets };
  }

  /**
   * Create bucket pipeline
   */
  bucket({
    groupBy,
    boundaries,
    default: defaultValue,
    output = {},
  }) {
    const bucketStage = {
      $bucket: {
        groupBy,
        boundaries,
        output,
      },
    };

    if (defaultValue !== undefined) {
      bucketStage.$bucket.default = defaultValue;
    }

    return bucketStage;
  }

  /**
   * Create bucketAuto pipeline
   */
  bucketAuto({
    groupBy,
    buckets,
    granularity,
    output = {},
  }) {
    const bucketStage = {
      $bucketAuto: {
        groupBy,
        buckets,
        output,
      },
    };

    if (granularity) {
      bucketStage.$bucketAuto.granularity = granularity;
    }

    return bucketStage;
  }

  /**
   * Create count pipeline
   */
  count(field = 'count') {
    return { $count: field };
  }

  /**
   * Create sample pipeline
   */
  sample(size) {
    return { $sample: { size } };
  }

  /**
   * Create replaceRoot pipeline
   */
  replaceRoot(newRoot) {
    return { $replaceRoot: { newRoot } };
  }

  /**
   * Create merge pipeline
   */
  merge({
    into,
    on = [],
    whenMatched = 'merge',
    whenNotMatched = 'insert',
  }) {
    return {
      $merge: {
        into,
        on,
        whenMatched,
        whenNotMatched,
      },
    };
  }

  /**
   * Create out pipeline
   */
  out(collection) {
    return { $out: collection };
  }

  /**
   * Create geoNear pipeline
   */
  geoNear({
    near,
    distanceField,
    spherical = true,
    maxDistance,
    minDistance,
    query = {},
    distanceMultiplier,
    includeLocs,
    uniqueDocs = true,
  }) {
    const geoNearStage = {
      $geoNear: {
        near,
        distanceField,
        spherical,
        query,
        uniqueDocs,
      },
    };

    if (maxDistance) geoNearStage.$geoNear.maxDistance = maxDistance;
    if (minDistance) geoNearStage.$geoNear.minDistance = minDistance;
    if (distanceMultiplier) geoNearStage.$geoNear.distanceMultiplier = distanceMultiplier;
    if (includeLocs) geoNearStage.$geoNear.includeLocs = includeLocs;

    return geoNearStage;
  }

  /**
   * Create redact pipeline
   */
  redact(expression) {
    return { $redact: expression };
  }

  /**
   * Create unionWith pipeline
   */
  unionWith(collection, pipeline = []) {
    return {
      $unionWith: {
        coll: collection,
        pipeline,
      },
    };
  }

  /**
   * Create set pipeline
   */
  set(fields) {
    return { $set: fields };
  }

  /**
   * Create unset pipeline
   */
  unset(fields) {
    return { $unset: fields };
  }

  /**
   * Create graphLookup pipeline
   */
  graphLookup({
    from,
    startWith,
    connectFromField,
    connectToField,
    as,
    maxDepth,
    depthField,
    restrictSearchWithMatch,
  }) {
    const graphLookupStage = {
      $graphLookup: {
        from,
        startWith,
        connectFromField,
        connectToField,
        as,
      },
    };

    if (maxDepth) graphLookupStage.$graphLookup.maxDepth = maxDepth;
    if (depthField) graphLookupStage.$graphLookup.depthField = depthField;
    if (restrictSearchWithMatch) {
      graphLookupStage.$graphLookup.restrictSearchWithMatch = restrictSearchWithMatch;
    }

    return graphLookupStage;
  }

  /**
   * Create facet pipeline for rentals analytics
   */
  rentalAnalyticsFacet() {
    return this.facet({
      byStatus: [
        this.group({
          id: '$status',
          fields: {
            count: { $sum: 1 },
            totalAmount: { $sum: '$rentalDetails.totalAmount' },
          },
        }),
      ],
      byMonth: [
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            count: { $sum: 1 },
            revenue: { $sum: '$rentalDetails.totalAmount' },
          },
        },
        this.sort({ '_id.year': 1, '_id.month': 1 }),
      ],
      byProduct: [
        this.group({
          id: '$product',
          fields: {
            count: { $sum: 1 },
            revenue: { $sum: '$rentalDetails.totalAmount' },
          },
        }),
        this.sort({ revenue: -1 }),
        this.limit(10),
        this.lookup({
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        }),
        this.unwind('product'),
        this.project({
          productId: '$_id',
          productName: '$product.basicInfo.name',
          count: 1,
          revenue: 1,
        }),
      ],
      totalStats: [
        this.group({
          id: null,
          fields: {
            totalRentals: { $sum: 1 },
            totalRevenue: { $sum: '$rentalDetails.totalAmount' },
            avgRentalValue: { $avg: '$rentalDetails.totalAmount' },
            minRentalValue: { $min: '$rentalDetails.totalAmount' },
            maxRentalValue: { $max: '$rentalDetails.totalAmount' },
          },
        }),
      ],
    });
  }

  /**
   * Create user activity pipeline
   */
  userActivityPipeline(userId) {
    return [
      this.match({ user: userId }),
      this.facet({
        rentals: [
          this.sort({ createdAt: -1 }),
          this.limit(10),
          this.project({
            rentalNumber: 1,
            status: 1,
            totalAmount: '$rentalDetails.totalAmount',
            createdAt: 1,
          }),
        ],
        payments: [
          this.lookup({
            from: 'payments',
            localField: '_id',
            foreignField: 'rental',
            as: 'payments',
          }),
          this.unwind('payments'),
          this.sort({ 'payments.createdAt': -1 }),
          this.limit(10),
          this.project({
            paymentNumber: '$payments.paymentNumber',
            amount: '$payments.amount',
            status: '$payments.status',
            type: '$payments.type',
            createdAt: '$payments.createdAt',
          }),
        ],
        reviews: [
          this.lookup({
            from: 'reviews',
            localField: '_id',
            foreignField: 'rental',
            as: 'reviews',
          }),
          this.unwind('reviews'),
          this.sort({ 'reviews.createdAt': -1 }),
          this.limit(10),
          this.project({
            rating: '$reviews.ratings.overall',
            title: '$reviews.title',
            createdAt: '$reviews.createdAt',
          }),
        ],
        stats: [
          this.group({
            id: null,
            fields: {
              totalRentals: { $sum: 1 },
              totalSpent: { $sum: '$rentalDetails.totalAmount' },
              activeRentals: {
                $sum: {
                  $cond: [
                    { $in: ['$status', ['active', 'confirmed', 'delivered']] },
                    1,
                    0,
                  ],
                },
              },
              completedRentals: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'completed'] }, 1, 0],
                },
              },
            },
          }),
        ],
      }),
    ];
  }

  /**
   * Create vendor performance pipeline
   */
  vendorPerformancePipeline(vendorId, startDate, endDate) {
    const match = { vendor: vendorId };
    
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    return [
      this.match(match),
      this.facet({
        overview: [
          this.group({
            id: null,
            fields: {
              totalRentals: { $sum: 1 },
              totalRevenue: { $sum: '$rentalDetails.totalAmount' },
              avgRentalValue: { $avg: '$rentalDetails.totalAmount' },
              completedRentals: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'completed'] }, 1, 0],
                },
              },
              cancelledRentals: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0],
                },
              },
            },
          }),
          this.addFields({
            completionRate: {
              $multiply: [
                { $divide: ['$completedRentals', { $max: ['$totalRentals', 1] }] },
                100,
              ],
            },
          }),
        ],
        byProduct: [
          this.group({
            id: '$product',
            fields: {
              rentalCount: { $sum: 1 },
              revenue: { $sum: '$rentalDetails.totalAmount' },
            },
          }),
          this.sort({ revenue: -1 }),
          this.limit(5),
          this.lookup({
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product',
          }),
          this.unwind('product'),
          this.project({
            productId: '$_id',
            productName: '$product.basicInfo.name',
            rentalCount: 1,
            revenue: 1,
          }),
        ],
        byMonth: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              rentals: { $sum: 1 },
              revenue: { $sum: '$rentalDetails.totalAmount' },
            },
          },
          this.sort({ '_id.year': 1, '_id.month': 1 }),
          this.project({
            year: '$_id.year',
            month: '$_id.month',
            rentals: 1,
            revenue: 1,
            date: {
              $dateFromParts: {
                year: '$_id.year',
                month: '$_id.month',
                day: 1,
              },
            },
          }),
        ],
      }),
    ];
  }

  /**
   * Create product analytics pipeline
   */
  productAnalyticsPipeline(productId) {
    return [
      this.match({ product: productId }),
      this.facet({
        overview: [
          this.group({
            id: null,
            fields: {
              totalRentals: { $sum: 1 },
              totalRevenue: { $sum: '$rentalDetails.totalAmount' },
              avgRentalDuration: { $avg: '$rentalDetails.tenureMonths' },
              activeRentals: {
                $sum: {
                  $cond: [
                    { $in: ['$status', ['active', 'confirmed', 'delivered']] },
                    1,
                    0,
                  ],
                },
              },
            },
          }),
        ],
        byMonth: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              count: { $sum: 1 },
              revenue: { $sum: '$rentalDetails.totalAmount' },
            },
          },
          this.sort({ '_id.year': 1, '_id.month': 1 }),
        ],
        userDemographics: [
          this.lookup({
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'user',
          }),
          this.unwind('user'),
          this.group({
            id: '$user.profile.city',
            fields: {
              count: { $sum: 1 },
            },
          }),
          this.sort({ count: -1 }),
          this.limit(5),
        ],
      }),
    ];
  }

  /**
   * Create payment analytics pipeline
   */
  paymentAnalyticsPipeline(startDate, endDate) {
    const match = {};
    
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    return [
      this.match(match),
      this.facet({
        byStatus: [
          this.group({
            id: '$status',
            fields: {
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
            },
          }),
        ],
        byMethod: [
          this.group({
            id: '$method',
            fields: {
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
            },
          }),
        ],
        byType: [
          this.group({
            id: '$type',
            fields: {
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
            },
          }),
        ],
        dailyStats: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
              },
              count: { $sum: 1 },
              amount: { $sum: '$amount' },
            },
          },
          this.sort({ '_id.year': 1, '_id.month': 1, '_id.day': 1 }),
        ],
        totals: [
          this.group({
            id: null,
            fields: {
              totalPayments: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
              avgAmount: { $avg: '$amount' },
              minAmount: { $min: '$amount' },
              maxAmount: { $max: '$amount' },
            },
          }),
        ],
      }),
    ];
  }

  /**
   * Create search ranking pipeline
   */
  searchRankingPipeline(searchTerm) {
    return [
      {
        $addFields: {
          relevanceScore: {
            $add: [
              { $multiply: [{ $indexOfCP: [{ $toLower: '$name' }, searchTerm.toLowerCase()] }, 10] },
              { $multiply: ['$ratings.average', 5] },
              { $multiply: [{ $divide: ['$ratings.count', 100] }, 2] },
              { $cond: [{ $eq: ['$status.isFeatured', true] }, 20, 0] },
            ],
          },
        },
      },
      this.match({ relevanceScore: { $gt: 0 } }),
      this.sort({ relevanceScore: -1 }),
    ];
  }

  /**
   * Create inventory status pipeline
   */
  inventoryStatusPipeline() {
    return [
      this.lookup({
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'product',
      }),
      this.unwind('product'),
      this.group({
        id: '$status',
        fields: {
          count: { $sum: 1 },
        },
        push: [
          {
            as: 'items',
            field: {
              sku: '$sku',
              productName: '$product.basicInfo.name',
              status: '$status',
              location: '$location',
            },
          },
        ],
      }),
      this.project({
        status: '$_id',
        count: 1,
        items: { $slice: ['$items', 10] },
      }),
    ];
  }

  /**
   * Create maintenance analytics pipeline
   */
  maintenanceAnalyticsPipeline(startDate, endDate) {
    const match = {};
    
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    return [
      this.match(match),
      this.facet({
        byType: [
          this.group({
            id: '$issueType',
            fields: {
              count: { $sum: 1 },
            },
          }),
        ],
        byPriority: [
          this.group({
            id: '$priority',
            fields: {
              count: { $sum: 1 },
            },
          }),
        ],
        byStatus: [
          this.group({
            id: '$status',
            fields: {
              count: { $sum: 1 },
            },
          }),
        ],
        resolutionTime: [
          this.match({
            status: 'completed',
            'schedule.actualEndDate': { $exists: true },
            'schedule.actualStartDate': { $exists: true },
          }),
          {
            $project: {
              resolutionTime: {
                $divide: [
                  { $subtract: ['$schedule.actualEndDate', '$schedule.actualStartDate'] },
                  3600000, // Convert to hours
                ],
              },
            },
          },
          this.group({
            id: null,
            fields: {
              avgResolutionTime: { $avg: '$resolutionTime' },
              minResolutionTime: { $min: '$resolutionTime' },
              maxResolutionTime: { $max: '$resolutionTime' },
            },
          }),
        ],
      }),
    ];
  }
}

module.exports = new AggregateUtils();