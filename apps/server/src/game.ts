// ==========================================
// SHARED GAME LOGIC (Server Authoritative)
// ==========================================

export type Side = 'BLUE' | 'RED';
export type ActionType = 'BAN' | 'PICK' | 'SWAP' | 'FINISH_SWAP' | 'START_GAME' | 'RESET_GAME' | 'TOGGLE_READY' | 'PAUSE_GAME' | 'RESUME_GAME' | 'SET_SIDES' | 'REPORT_RESULT';
export type DraftPhase = 'DRAFT' | 'SWAP' | 'FINISHED';
export type DraftStatus = 'NOT_STARTED' | 'RUNNING' | 'FINISHED';
export type Role = 'TOP' | 'JG' | 'MID' | 'BOT' | 'SUP' | 'SPECIAL';
export type SeriesMode = 'BO1' | 'BO2' | 'BO3' | 'BO5';
export type DraftMode = 'STANDARD' | 'FEARLESS';
export type TeamId = 'TEAM_A' | 'TEAM_B';

export const STEP_DURATION_MS = 30000;
export const SPECIAL_ID_NONE = 'special_none';
export const SPECIAL_ID_RANDOM = 'special_random';

export interface DraftStep {
  index: number;
  side: Side;
  type: 'BAN' | 'PICK';
}

export interface DraftAction {
  seq: number;
  stepIndex: number;
  type: ActionType;
  side?: Side;
  heroId?: string;
  swapData?: { fromIndex: number; toIndex: number };
  actorRole?: string; 
  reason?: string;
  payload?: any; 
}

export interface GameResultSnapshot {
  gameIdx: number;
  winner: TeamId;
  blueSideTeam: TeamId;
  redSideTeam: TeamId;
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
}

export interface DraftState {
  lastActionSeq: number;
  
  matchTitle: string;
  seriesMode: SeriesMode;
  draftMode: DraftMode;
  teamA: { name: string; wins: number };
  teamB: { name: string; wins: number };
  currentGameIdx: number; 
  sides: { [key in TeamId]: Side | null }; 
  nextSideSelector: TeamId | 'REFEREE' | null; 
  
  seriesHistory: GameResultSnapshot[];

  status: DraftStatus;
  phase: DraftPhase;
  stepIndex: number; 
  draftStepIndex: number; 
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
  history: DraftAction[]; 
  stepEndsAt: number;
  blueReady: boolean;
  redReady: boolean;
  paused: boolean;
  pauseReason?: string;
  pausedAt?: number;
}

interface Hero { id: string; }
const HERO_IDS = [
  'aatrox', 'ahri', 'akali', 'amumu', 'annie', 'ashe', 'blitz', 'caitlyn', 'camille', 'darius', 
  'ezreal', 'fiora', 'garen', 'jinx', 'kaisa', 'leesin', 'leona', 'lux', 'malphite', 'masteryi', 
  'missfortune', 'nautilus', 'sett', 'teemo', 'thresh', 'vi', 'viego', 'yasuo', 'yone', 'zed'
];

const DRAFT_SEQUENCE: Omit<DraftStep, 'index'>[] = [
  { side: 'BLUE', type: 'BAN' }, { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'BAN' }, { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'BAN' }, { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'PICK' }, { side: 'RED', type: 'PICK' }, { side: 'RED', type: 'PICK' },
  { side: 'BLUE', type: 'PICK' }, { side: 'BLUE', type: 'PICK' }, { side: 'RED', type: 'PICK' },
  { side: 'RED', type: 'BAN' }, { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'BAN' }, { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'PICK' }, { side: 'BLUE', type: 'PICK' }, { side: 'BLUE', type: 'PICK' }, { side: 'RED', type: 'PICK' },
];

export const INITIAL_STATE: DraftState = {
  lastActionSeq: 0,
  
  matchTitle: '',
  seriesMode: 'BO1',
  draftMode: 'STANDARD',
  teamA: { name: 'Team A', wins: 0 },
  teamB: { name: 'Team B', wins: 0 },
  currentGameIdx: 1,
  sides: { TEAM_A: null, TEAM_B: null },
  nextSideSelector: 'REFEREE',
  seriesHistory: [],

  status: 'NOT_STARTED',
  phase: 'DRAFT',
  stepIndex: 0,
  draftStepIndex: 0,
  blueBans: [],
  redBans: [],
  bluePicks: [],
  redPicks: [],
  history: [],
  stepEndsAt: 0,
  blueReady: false,
  redReady: false,
  paused: false,
};

export const getCurrentStep = (state: DraftState): DraftStep | null => {
  if (state.draftStepIndex >= DRAFT_SEQUENCE.length) return null;
  return { ...DRAFT_SEQUENCE[state.draftStepIndex], index: state.draftStepIndex };
};

const getSideFromRole = (state: DraftState, role: string): Side | null => {
  if (role === 'TEAM_A') return state.sides.TEAM_A;
  if (role === 'TEAM_B') return state.sides.TEAM_B;
  return null;
};

// --- FEARLESS LOGIC ---
const getFearlessBannedIds = (state: DraftState): Set<string> => {
  const set = new Set<string>();
  if (state.draftMode !== 'FEARLESS') return set;
  
  state.seriesHistory.forEach(game => {
    game.bluePicks.forEach(id => set.add(id));
    game.redPicks.forEach(id => set.add(id));
  });
  return set;
};

// --- VALIDATION LOGIC ---
export const validateMove = (state: DraftState, payload: any): string | null => {
  const { actorRole, type, side, heroId } = payload; 

  if (!actorRole) return "Unauthorized: No role specified";
  if (actorRole === 'SPECTATOR') return "Spectators cannot perform actions";

  if (['START_GAME', 'RESET_GAME', 'PAUSE_GAME', 'RESUME_GAME', 'REPORT_RESULT'].includes(type)) {
      if (actorRole !== 'REFEREE') return "Only Referee can manage game state";
      if (type === 'START_GAME') {
        if (!state.sides.TEAM_A || !state.sides.TEAM_B) return "Sides not selected yet";
        if (!state.blueReady || !state.redReady) return "Both teams must be READY to start";
      }
      return null;
  }

  if (type === 'SET_SIDES') {
    if (state.status !== 'NOT_STARTED') return "Cannot set sides after game started";
    const selector = state.nextSideSelector || 'REFEREE';
    if (actorRole !== selector && actorRole !== 'REFEREE') { 
       return `Waiting for ${selector} to select sides`;
    }
    return null;
  }

  if (type === 'TOGGLE_READY') {
    if (state.status !== 'NOT_STARTED') return "Cannot toggle ready after game started";
    if (!state.sides.TEAM_A) return "Sides must be set before ready";
    return null;
  }

  if (state.paused) return `Game is paused (${state.pauseReason})`;

  if (state.status !== 'RUNNING') return `Game is ${state.status}`;
  if (actorRole === 'REFEREE') return null; 

  const actorSide = getSideFromRole(state, actorRole);
  if (!actorSide) return "You are not assigned a side";

  if (state.phase === 'DRAFT') {
    const currentStep = getCurrentStep(state);
    if (!currentStep) return "Draft finished";
    if (currentStep.side !== actorSide) return `Not your turn`;

    // Fearless Check
    if (heroId && state.draftMode === 'FEARLESS') {
       if (heroId !== SPECIAL_ID_NONE && heroId !== SPECIAL_ID_RANDOM) {
         const fearlessBans = getFearlessBannedIds(state);
         if (fearlessBans.has(heroId)) {
           return "Hero unavailable in Global Fearless mode (picked in previous game)";
         }
       }
    }

    return null;
  }

  if (state.phase === 'SWAP') {
    if (type === 'SWAP') {
      if (payload.side !== actorSide) return "Wrong side";
      return null;
    }
  }

  return "Invalid action";
};

const reduceState = (state: DraftState, action: DraftAction): DraftState => {
  const newState = { ...state };
  newState.lastActionSeq = action.seq;

  switch (action.type) {
    case 'SET_SIDES':
      const sideA = action.payload.sideForA as Side;
      const sideB = sideA === 'BLUE' ? 'RED' : 'BLUE';
      newState.sides = { TEAM_A: sideA, TEAM_B: sideB };
      newState.blueReady = false;
      newState.redReady = false;
      break;

    case 'TOGGLE_READY':
      const targetSide = action.side;
      if (targetSide === 'BLUE') newState.blueReady = !newState.blueReady;
      if (targetSide === 'RED') newState.redReady = !newState.redReady;
      break;

    case 'START_GAME':
      newState.status = 'RUNNING';
      break;

    case 'REPORT_RESULT':
      const winner = action.payload.winner as TeamId;
      if (winner === 'TEAM_A') newState.teamA.wins++;
      else newState.teamB.wins++;
      
      const gameRecord: GameResultSnapshot = {
        gameIdx: state.currentGameIdx,
        winner,
        blueSideTeam: state.sides.TEAM_A === 'BLUE' ? 'TEAM_A' : 'TEAM_B',
        redSideTeam: state.sides.TEAM_A === 'RED' ? 'TEAM_A' : 'TEAM_B',
        blueBans: state.blueBans,
        redBans: state.redBans,
        bluePicks: state.bluePicks,
        redPicks: state.redPicks
      };
      newState.seriesHistory = [...(state.seriesHistory || []), gameRecord];

      let isSeriesOver = false;
      const winsNeeded = Math.ceil(parseInt(state.seriesMode.replace('BO', '')) / 2);
      
      if (state.seriesMode === 'BO2') {
        if (state.currentGameIdx >= 2) isSeriesOver = true;
      } else {
        if (newState.teamA.wins >= winsNeeded || newState.teamB.wins >= winsNeeded) isSeriesOver = true;
      }

      if (!isSeriesOver) {
        newState.currentGameIdx++;
        newState.status = 'NOT_STARTED';
        newState.phase = 'DRAFT';
        newState.draftStepIndex = 0;
        newState.stepIndex = 0;
        newState.blueBans = []; newState.redBans = [];
        newState.bluePicks = []; newState.redPicks = [];
        newState.blueReady = false; newState.redReady = false;
        newState.stepEndsAt = 0;
        
        const loser = winner === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A';
        newState.nextSideSelector = loser;
        newState.sides = { TEAM_A: null, TEAM_B: null };
      } else {
        newState.nextSideSelector = null; 
      }
      break;

    case 'RESET_GAME':
      return {
        ...INITIAL_STATE,
        matchTitle: state.matchTitle,
        seriesMode: state.seriesMode,
        draftMode: state.draftMode,
        teamA: { ...state.teamA, wins: 0 },
        teamB: { ...state.teamB, wins: 0 },
        lastActionSeq: action.seq
      };

    case 'PAUSE_GAME':
      newState.paused = true;
      newState.pauseReason = action.reason;
      break;
    case 'RESUME_GAME':
      newState.paused = false;
      newState.pauseReason = undefined;
      break;

    case 'BAN':
      if (action.side === 'BLUE') newState.blueBans = [...newState.blueBans, action.heroId!];
      else newState.redBans = [...newState.redBans, action.heroId!];
      newState.draftStepIndex++;
      break; 
    case 'PICK':
      if (action.side === 'BLUE') newState.bluePicks = [...newState.bluePicks, action.heroId!];
      else newState.redPicks = [...newState.redPicks, action.heroId!];
      newState.draftStepIndex++;
      break;
    case 'SWAP':
      if (action.swapData && action.side) {
        const { fromIndex, toIndex } = action.swapData;
        const list = action.side === 'BLUE' ? [...newState.bluePicks] : [...newState.redPicks];
        const temp = list[fromIndex];
        list[fromIndex] = list[toIndex];
        list[toIndex] = temp;
        if (action.side === 'BLUE') newState.bluePicks = list;
        else newState.redPicks = list;
      }
      break;
    case 'FINISH_SWAP':
      newState.phase = 'FINISHED';
      newState.status = 'FINISHED';
      newState.stepEndsAt = 0;
      break;
  }

  if (newState.status === 'RUNNING' && newState.phase === 'DRAFT' && newState.draftStepIndex >= DRAFT_SEQUENCE.length) {
    newState.phase = 'SWAP';
  }

  newState.stepIndex = action.stepIndex + 1;
  return newState;
}

export const applyAction = (state: DraftState, payload: any, now: number): DraftState => {
  let action: DraftAction | null = null;
  const nextSeq = state.lastActionSeq + 1;

  if (['START_GAME', 'RESET_GAME', 'TOGGLE_READY', 'PAUSE_GAME', 'RESUME_GAME', 'SET_SIDES', 'REPORT_RESULT'].includes(payload.type)) {
      action = { 
        seq: nextSeq,
        stepIndex: state.stepIndex, 
        type: payload.type, 
        actorRole: payload.actorRole,
        side: payload.side, 
        reason: payload.reason,
        payload: payload 
      };
  } 
  else if (state.status === 'RUNNING' && !state.paused) {
      const currentStep = getCurrentStep(state);
      
      if (state.phase === 'DRAFT') {
        if (currentStep) {
            let resolvedHeroId = payload.heroId;
            if (resolvedHeroId === SPECIAL_ID_RANDOM) {
                const usedHeroes = new Set([...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks]);
                // Fearless Random Logic
                const fearlessBans = getFearlessBannedIds(state);
                
                const available = HERO_IDS.filter(id => !usedHeroes.has(id) && !fearlessBans.has(id));
                if (available.length > 0) {
                  const randomIndex = Math.floor(Math.random() * available.length);
                  resolvedHeroId = available[randomIndex];
                } else {
                  resolvedHeroId = SPECIAL_ID_NONE; 
                }
            }
            action = {
              seq: nextSeq,
              stepIndex: state.stepIndex,
              heroId: resolvedHeroId,
              side: currentStep.side, 
              type: currentStep.type,
              actorRole: payload.actorRole
            };
        }
      } else if (state.phase === 'SWAP') {
        if (payload.type === 'SWAP') {
          action = {
            seq: nextSeq,
            stepIndex: state.stepIndex,
            type: 'SWAP',
            side: payload.side, 
            swapData: payload.swapData,
            actorRole: payload.actorRole
          };
        } else if (payload.type === 'FINISH_SWAP') {
          action = { seq: nextSeq, stepIndex: state.stepIndex, type: 'FINISH_SWAP', actorRole: payload.actorRole }
        }
      }
  }

  if (!action) return state;

  const newState = reduceState(state, action);
  
  if (action.type === 'PAUSE_GAME') {
      if (!state.paused) newState.pausedAt = now;
      else newState.pausedAt = state.pausedAt;
  } else if (action.type === 'RESUME_GAME') {
      if (state.pausedAt) {
          newState.stepEndsAt = state.stepEndsAt + (now - state.pausedAt);
          newState.pausedAt = undefined;
      }
  } else if (newState.status === 'RUNNING' && newState.phase !== 'FINISHED' && !newState.paused) {
      if (action.type === 'START_GAME') {
          newState.stepEndsAt = now + STEP_DURATION_MS;
      } else if (state.phase === 'DRAFT' && newState.phase === 'SWAP') {
          newState.stepEndsAt = now + STEP_DURATION_MS; 
      } else if (newState.phase === 'DRAFT') {
          newState.stepEndsAt = now + STEP_DURATION_MS;
      } else {
        // Swap 阶段内部动作不重置时间
        newState.stepEndsAt = state.stepEndsAt;
      }
  } else if (newState.phase === 'FINISHED') {
      newState.stepEndsAt = 0;
  }

  newState.history = [...state.history, action];
  return newState;
};

export const replay = (history: DraftAction[], now: number): DraftState => {
    let state = { ...INITIAL_STATE }; 
    for (const action of history) {
        state = reduceState(state, action);
    }
    state.history = history;
    if (state.status === 'RUNNING' && state.phase !== 'FINISHED' && !state.paused) {
        state.stepEndsAt = now + STEP_DURATION_MS;
    } else {
        state.stepEndsAt = 0;
    }
    return state;
}