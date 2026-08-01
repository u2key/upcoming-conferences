'use strict';

const { Server } = require('socket.io');
const conferences = require('./services/conferences');

/**
 * Attach Socket.io to an HTTP server for real-time conference list updates.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: false },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    // Send current public list on connect
    try {
      socket.emit('conferences:update', {
        reason: 'sync',
        conferences: conferences.list({ includeHidden: false }),
      });
    } catch (e) {
      console.warn('[socket] initial sync failed:', e.message);
    }

    socket.on('conferences:refresh', () => {
      try {
        socket.emit('conferences:update', {
          reason: 'refresh',
          conferences: conferences.list({ includeHidden: false }),
        });
      } catch (e) {
        socket.emit('error', { message: e.message });
      }
    });
  });

  /**
   * Broadcast conference changes to all connected clients.
   * @param {{ reason: string, conference?: object, conferences?: object[] }} payload
   */
  function broadcastConferences(payload) {
    const full = {
      reason: payload.reason || 'update',
      conference: payload.conference || null,
      conferences:
        payload.conferences || conferences.list({ includeHidden: false }),
      at: new Date().toISOString(),
    };
    io.emit('conferences:update', full);
  }

  return { io, broadcastConferences };
}

module.exports = { attachSocket };
