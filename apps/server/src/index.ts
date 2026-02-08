import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import {
  DraftState,
  INITIAL_STATE,
  applyAction,
  validateMove,
  replay,
  SPECIAL_ID_RANDOM,
  ChatMessage
} from './game';
import { getRoomState, saveRoomState, saveActionAndUpdateState, getRoomActions } from './db';

const PORT = 8080;

interface Room {
  id: string;
  state: DraftState;
  clients: Set<WebSocket>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

const getOrCreateRoom = (roomId: string, initialConfig?: any): Room => {
  let room = rooms.get(roomId);

  if (!room) {
    const persistedState = getRoomState(roomId);

    if (persistedState) {
      console.log(`Restored room from Disk: ${roomId}`);
      const safeState: DraftState = {
        ...INITIAL_STATE,
        ...persistedState,
        teamA: persistedState.teamA || { name: 'Team A', wins: 0 },
        teamB: persistedState.teamB || { name: 'Team B', wins: 0 },
        sides: persistedState.sides || { TEAM_A: null, TEAM_B: null },
        seriesHistory: Array.isArray(persistedState.seriesHistory) ? persistedState.seriesHistory : [],
        timeLimit: persistedState.timeLimit !== undefined ? persistedState.timeLimit : 30,
        separateSideAndBpOrder: persistedState.separateSideAndBpOrder !== undefined ? persistedState.separateSideAndBpOrder : false,
        bpFirstTeam: persistedState.bpFirstTeam !== undefined ? persistedState.bpFirstTeam : null,
        matchTitle: persistedState.matchTitle || '',
        seriesMode: persistedState.seriesMode || 'BO1',
        draftMode: persistedState.draftMode || 'STANDARD',
        status: persistedState.status || 'NOT_STARTED',
        phase: persistedState.phase || 'DRAFT',
        blueBans: persistedState.blueBans || [],
        redBans: persistedState.redBans || [],
        bluePicks: persistedState.bluePicks || [],
        redPicks: persistedState.redPicks || [],
        history: persistedState.history || [],
        // ✅ 确保恢复聊天
        chatMessages: persistedState.chatMessages || []
      };

      if (safeState.status === 'NOT_STARTED') {
        safeState.draftStepIndex = 0;
        safeState.stepIndex = 0;
        safeState.blueBans = [];
        safeState.redBans = [];
        safeState.bluePicks = [];
        safeState.redPicks = [];
        safeState.stepEndsAt = 0;
      }
      if (!safeState.sides) safeState.sides = { TEAM_A: null, TEAM_B: null };
      if (safeState.sides.TEAM_A === undefined) safeState.sides.TEAM_A = null;
      if (safeState.sides.TEAM_B === undefined) safeState.sides.TEAM_B = null;

      room = {
        id: roomId,
        state: safeState,
        clients: new Set(),
        lastActivity: Date.now()
      };
      saveRoomState(roomId, safeState);
    } else {
      console.log(`Creating new room: ${roomId}`);
      const initialState: DraftState = {
        ...INITIAL_STATE,
        status: 'NOT_STARTED',
        blueReady: false,
        redReady: false,
        paused: false,
        stepEndsAt: 0,
        lastActionSeq: 0,
        matchTitle: initialConfig?.matchTitle || 'Exhibition Match',
        seriesMode: initialConfig?.seriesMode || 'BO1',
        draftMode: initialConfig?.draftMode || 'STANDARD',
        timeLimit: initialConfig?.timeLimit !== undefined ? initialConfig.timeLimit : 30,
        separateSideAndBpOrder: initialConfig?.separateSideAndBpOrder !== undefined ? initialConfig.separateSideAndBpOrder : false,
        bpFirstTeam: null,
        teamA: { name: initialConfig?.teamA || 'Team A', wins: 0 },
        teamB: { name: initialConfig?.teamB || 'Team B', wins: 0 },
        sides: { TEAM_A: null, TEAM_B: null },
        chatMessages: [],
      };
      room = {
        id: roomId,
        state: initialState,
        clients: new Set(),
        lastActivity: Date.now()
      };
      saveRoomState(roomId, initialState);
    }
    rooms.set(roomId, room);
  }
  return room;
};

const broadcastToRoom = (room: Room) => {
  const message = JSON.stringify({
    type: 'STATE_SYNC',
    payload: room.state,
    timestamp: Date.now()
  });

  room.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = parse(req.url || '', true);

  if (req.method === 'POST' && url.pathname === '/rooms') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const config = JSON.parse(body || '{}');
        const roomId = Math.random().toString(36).substring(2, 8);
        getOrCreateRoom(roomId, config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ roomId }));
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname?.match(/^\/rooms\/[a-zA-Z0-9]+\/actions$/)) {
    const roomId = url.pathname.split('/')[2];
    const afterSeq = parseInt(url.query.afterSeq as string || '0', 10);
    const missingActions = getRoomActions(roomId, afterSeq);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ actions: missingActions }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(parse(req.url || '').query || '');
  const roomId = urlParams.get('room') || 'default';
  const room = getOrCreateRoom(roomId);

  room.clients.add(ws);

  ws.send(JSON.stringify({
    type: 'STATE_SYNC',
    payload: room.state,
    timestamp: Date.now()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      room.lastActivity = Date.now();

      // ✅ 新增：聊天处理
      if (data.type === 'CHAT_SEND') {
        const { actorRole, text } = data.payload || {};
        if (actorRole && text && typeof text === 'string' && text.trim().length > 0) {
          const msg: ChatMessage = {
            id: Math.random().toString(36).substring(2),
            senderRole: actorRole,
            content: text.trim(),
            timestamp: Date.now()
          };
          room.state.chatMessages.push(msg);
          // 简单限制一下长度，防止无限增长
          if (room.state.chatMessages.length > 200) {
            room.state.chatMessages = room.state.chatMessages.slice(-200);
          }
          saveRoomState(roomId, room.state);
          broadcastToRoom(room);
        }
        return; 
      }

      if (data.type === 'ACTION_SUBMIT' || data.type === 'TOGGLE_READY') {
        const payload = data.type === 'TOGGLE_READY'
          ? { ...data.payload, type: 'TOGGLE_READY' }
          : data.payload;

        const error = validateMove(room.state, payload);
        if (error) {
          ws.send(JSON.stringify({ type: 'ACTION_REJECTED', payload: { reason: error } }));
          return;
        }

        const now = Date.now();
        const newState = applyAction(room.state, payload, now);

        const newAction = newState.history[newState.history.length - 1];
        if (newAction) saveActionAndUpdateState(roomId, newAction, newState);
        else saveRoomState(roomId, newState);

        room.state = newState;
        broadcastToRoom(room);
      }

      if (data.type === 'ACTION_UNDO') {
        if (room.state.history.length > 0) {
          const newHistory = room.state.history.slice(0, -1);
          // undo 时需要保留当前的聊天记录
          const newState = replay(newHistory, Date.now(), room.state);
          saveRoomState(roomId, newState);
          room.state = newState;
          broadcastToRoom(room);
        }
      }

      if (data.type === 'ACTION_RESET') {
        const newState = applyAction(room.state, { type: 'RESET_GAME', actorRole: 'REFEREE' }, Date.now());
        saveRoomState(roomId, newState);
        room.state = newState;
        broadcastToRoom(room);
      }

    } catch (e) {
      console.error('Error processing message', e);
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (room.state.paused) return;
    if (room.state.status !== 'RUNNING') return;

    if (room.state.stepEndsAt > 0 && now > room.state.stepEndsAt) {
      console.log(`[Room ${room.id}] Timeout triggered. Auto-picking...`);

      let newState = room.state;
      if (room.state.phase === 'DRAFT') {
        newState = applyAction(room.state, { heroId: SPECIAL_ID_RANDOM, actorRole: 'REFEREE' }, now);
      } else if (room.state.phase === 'SWAP') {
        newState = applyAction(room.state, { type: 'FINISH_SWAP', actorRole: 'REFEREE' }, now);
      }

      if (newState !== room.state) {
        const newAction = newState.history[newState.history.length - 1];
        if (newAction) saveActionAndUpdateState(room.id, newAction, newState);
        room.state = newState;
        broadcastToRoom(room);
      }
    }
  });
}, 500);

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
