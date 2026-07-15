const eventEmitter = require('./eventEmitter');
const logger = require('../config/logger');
const { emitToRoom, emitToUser } = require('../socket/emitter');

const buildLocationPayload = (data) => ({
  deliveryId: data.deliveryId,
  deliveryNumber: data.deliveryNumber,
  location: data.location,
  status: data.status,
  estimatedArrival: data.estimatedArrival,
  personId: data.personId,
  timestamp: data.timestamp || new Date(),
});

eventEmitter.on('delivery:location-updated', async (data) => {
  try {
    const payload = buildLocationPayload(data);

    if (data.deliveryId) {
      emitToRoom(`delivery:${data.deliveryId}`, 'delivery:location', payload);
    }

    if (data.deliveryNumber) {
      emitToRoom(`delivery:track:${data.deliveryNumber}`, 'delivery:location', payload);
    }

    if (data.customerUserId) {
      emitToUser(data.customerUserId, 'delivery:tracking', payload);
    }
  } catch (error) {
    logger.error('delivery:location-updated socket handler error:', error);
  }
});

eventEmitter.on('delivery:partner-location-updated', async (data) => {
  try {
    const payload = {
      personId: data.personId,
      userId: data.userId,
      location: data.location,
      currentLocation: data.currentLocation,
      activeDeliveryIds: data.activeDeliveryIds || [],
      timestamp: data.timestamp || new Date(),
    };

    emitToRoom(`delivery:partner:${data.personId}`, 'delivery:partner:location', payload);

    if (data.userId) {
      emitToUser(data.userId, 'delivery:partner:location', payload);
    }

    for (const deliveryId of payload.activeDeliveryIds) {
      emitToRoom(`delivery:${deliveryId}`, 'delivery:partner:location', payload);
    }
  } catch (error) {
    logger.error('delivery:partner-location-updated socket handler error:', error);
  }
});

module.exports = eventEmitter;
