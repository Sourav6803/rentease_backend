let io;

const setIO = (socketIO) => {
  io = socketIO;
};

const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

const emitToVendor = (vendorId, event, data) => {
  if (!io) return;
  io.to(`vendor:${vendorId}`).emit(event, data);
};

const emitToAdmins = (event, data) => {
  if (!io) return;
  io.to('admins').emit(event, data);
};

const emitToRoom = (room, event, data) => {
  if (!io) return;
  io.to(room).emit(event, data);
};

module.exports = {
  setIO,
  emitToUser,
  emitToVendor,
  emitToAdmins,
  emitToRoom
};