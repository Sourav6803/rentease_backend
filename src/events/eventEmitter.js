// const EventEmitter = require('events');
// const logger = require('../config/logger');

// class AppEventEmitter extends EventEmitter {
//   constructor() {
//     super();
//     this.setMaxListeners(50); // Increase max listeners if needed
//   }

//   // Emit event with logging
//   emit(event, data) {
//     logger.debug(`Event emitted: ${event}`, { event, data });
//     return super.emit(event, data);
//   }

//   // Emit event asynchronously (non-blocking)
//   emitAsync(event, data) {
//     setImmediate(() => {
//       this.emit(event, data);
//     });
//   }

//   // Emit event with promise
//   emitPromise(event, data) {
//     return new Promise((resolve, reject) => {
//       const timeout = setTimeout(() => {
//         reject(new Error(`Event ${event} timeout`));
//       }, 5000);

//       this.once(`${event}:done`, (result) => {
//         clearTimeout(timeout);
//         resolve(result);
//       });

//       this.once(`${event}:error`, (error) => {
//         clearTimeout(timeout);
//         reject(error);
//       });

//       this.emit(event, data);
//     });
//   }

//   // Wait for event
//   waitFor(event, timeout = 5000) {
//     return new Promise((resolve, reject) => {
//       const timer = setTimeout(() => {
//         reject(new Error(`Timeout waiting for ${event}`));
//       }, timeout);

//       this.once(event, (data) => {
//         clearTimeout(timer);
//         resolve(data);
//       });
//     });
//   }
// }

// const eventEmitter = new AppEventEmitter();

// // Log all events in development
// if (process.env.NODE_ENV === 'development') {
//   eventEmitter.on('*', (event, data) => {
//     logger.debug(`Event captured: ${event}`, data);
//   });
// }

// module.exports = eventEmitter;

// const EventEmitter = require('events');
// const logger = require('../config/logger');

// class AppEventEmitter extends EventEmitter {
//   constructor() {
//     super();
//     this.setMaxListeners(50);
//   }

//   // Emit event with logging
//   emit(event, data) {
//     if (process.env.NODE_ENV === 'development') {
//       logger.debug(`Event emitted: ${event}`, { data });
//     }

//     return super.emit(event, data);
//   }

//   // Emit event asynchronously (non-blocking)
//   emitAsync(event, data) {
//     setImmediate(() => {
//       this.emit(event, data);
//     });
//   }

//   // Emit event with promise response
//   emitPromise(event, data, timeout = 5000) {
//     return new Promise((resolve, reject) => {
//       const timer = setTimeout(() => {
//         reject(new Error(`Event ${event} timeout`));
//       }, timeout);

//       this.once(`${event}:done`, (result) => {
//         clearTimeout(timer);
//         resolve(result);
//       });

//       this.once(`${event}:error`, (error) => {
//         clearTimeout(timer);
//         reject(error);
//       });

//       this.emit(event, data);
//     });
//   }

//   // Wait for event
//   waitFor(event, timeout = 5000) {
//     return new Promise((resolve, reject) => {
//       const timer = setTimeout(() => {
//         reject(new Error(`Timeout waiting for ${event}`));
//       }, timeout);

//       this.once(event, (data) => {
//         clearTimeout(timer);
//         resolve(data);
//       });
//     });
//   }
// }

// const eventEmitter = new AppEventEmitter();

// module.exports = eventEmitter;



const EventEmitter = require('events');
const logger = require('../config/logger');

class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emit(event, data) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`Event emitted: ${event}`, { data });
    }

    return super.emit(event, data);
  }

  emitAsync(event, data) {
    setImmediate(() => {
      this.emit(event, data);
    });
  }

  safeEmit(event, data) {
    try {
      this.emit(event, data);
    } catch (error) {
      logger.error(`Event error: ${event}`, error);
    }
  }

  emitPromise(event, data, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Event ${event} timeout`));
      }, timeout);

      this.once(`${event}:done`, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      this.once(`${event}:error`, (error) => {
        clearTimeout(timer);
        reject(error);
      });

      this.emit(event, data);
    });
  }

  waitFor(event, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${event}`));
      }, timeout);

      this.once(event, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }
}

module.exports = new AppEventEmitter();