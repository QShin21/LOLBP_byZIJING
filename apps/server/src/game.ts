// ==========================================
// SHARED GAME LOGIC (Server Authoritative)
// ==========================================

export type Side = 'BLUE' | 'RED';
export type ActionType =
  | 'BAN'
  | 'PICK'
  | 'SWAP'
  | 'FINISH_SWAP'
  | 'START_GAME'
  | 'RESET_GAME'
  | 'TOGGLE_READY'
  | 'PAUSE_GAME'
  | 'RESUME_GAME'
  | 'SET_SIDES'
  | 'REPORT_RESULT';
export type DraftPhase = 'DRAFT' | 'SWAP' | 'FINISHED';
export type DraftStatus = 'NOT_STARTED' | 'RUNNING' | 'FINISHED';
export type Role = 'TOP' | 'JG' | 'MID' | 'BOT' | 'SUP' | 'SPECIAL';
export type SeriesMode = 'BO1' | 'BO2' | 'BO3' | 'BO5';
export type DraftMode = 'STANDARD' | 'FEARLESS';
export type TeamId = 'TEAM_A' | 'TEAM_B';

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
  timeLimit: number; // <--- 每回合秒数 (0 代表无上限)
  teamA: { name: string; wins: number };
  teamB: { name: string; wins: number };
  currentGameIdx: number;
  sides: { [key in TeamId]: Side | null };
  nextSideSelector: TeamId | 'REFEREE' | null;

  // ✅ 是否开启“地图颜色(蓝/红)与BP顺序分离”
  // 关闭：BP顺序固定按当前蓝色方先手（与旧逻辑一致）
  // 开启：由 bpFirstTeam 决定哪一方获得“先手 BP 权”(即替代原本 BLUE 的先手位置)
  separateSideAndBpOrder: boolean;
  bpFirstTeam: TeamId | null;

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

// =========================================================
// HERO IDS (Front/Back-end Single Source of Truth)
// =========================================================

type HeroLike = { id: string };

const CANDIDATE_MODULE_PATHS = [
  // ✅ 方案A：优先读取复制到后端本地的文件 (位于 apps/server/src/data/heroes.ts)
  './data/heroes',

  // ✅ 方案B：或者读取源码 TS 文件 (位于 apps/server/src/data/heroes.ts)
  '../src/data/heroes',
];

function extractHeroIdsFromModule(mod: any): string[] {
  // 兼容几种常见导出：HEROES / RAW_HEROES / default
  const candidates = [mod?.HEROES, mod?.RAW_HEROES, mod?.default].filter(Boolean);
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const ids = c
        .map((h: HeroLike) => (typeof h?.id === 'string' ? h.id : ''))
        .filter((s: string) => !!s);
      if (ids.length) return ids;
    }
  }

  // 兼容：模块里直接导出 HERO_IDS
  if (Array.isArray(mod?.HERO_IDS) && mod.HERO_IDS.length) {
    return mod.HERO_IDS.filter((s: any) => typeof s === 'string' && s.length > 0);
  }

  return [];
}

function loadHeroIdsOrThrow(): string[] {
  const errors: string[] = [];
  for (const p of CANDIDATE_MODULE_PATHS) {
    try {
      // 直接使用全局 require (CommonJS)
      const mod = require(p);
      const ids = extractHeroIdsFromModule(mod);
      if (ids.length) return ids;
      errors.push(`${p}: module loaded but no hero ids exported (HEROES/RAW_HEROES/HERO_IDS/default)`);
    } catch (e: any) {
      errors.push(`${p}: ${e?.message ?? String(e)}`);
    }
  }
  throw new Error(
    [
      '[game.ts] Failed to load hero ids from front-end source.',
      'Tried paths:',
      ...errors.map((s) => `  - ${s}`),
      '',
      'Fix options:',
      '  - Ensure apps/server/src/data/heroes.ts exists (copied from web).',
    ].join('\n')
  );
}

// ✅ 后端随机、校验等全部使用同一份 HERO_IDS
const HERO_IDS: string[] = loadHeroIdsOrThrow();

// base 序列：默认假设 BLUE 是 BP 先手方
const DRAFT_SEQUENCE: Omit<DraftStep, 'index'>[] = [
  { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'PICK' },
  { side: 'RED', type: 'PICK' },
  { side: 'RED', type: 'PICK' },
  { side: 'BLUE', type: 'PICK' },
  { side: 'BLUE', type: 'PICK' },
  { side: 'RED', type: 'PICK' },
  { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'BAN' },
  { side: 'BLUE', type: 'BAN' },
  { side: 'RED', type: 'PICK' },
  { side: 'BLUE', type: 'PICK' },
  { side: 'BLUE', type: 'PICK' },
  { side: 'RED', type: 'PICK' },
];

export const INITIAL_STATE: DraftState = {
  lastActionSeq: 0,

  matchTitle: '',
  seriesMode: 'BO1',
  draftMode: 'STANDARD',
  timeLimit: 30, // 默认 30s
  teamA: { name: 'Team A', wins: 0 },
  teamB: { name: 'Team B', wins: 0 },
  currentGameIdx: 1,
  sides: { TEAM_A: null, TEAM_B: null },
  nextSideSelector: 'REFEREE',

  separateSideAndBpOrder: false,
  bpFirstTeam: null,
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
  const base = DRAFT_SEQUENCE[state.draftStepIndex];

  // ✅ BP 先手方(颜色)计算：默认 BLUE 先手；开启分离后由 bpFirstTeam 决定
  const bpFirstSide: Side = (() => {
    if (!state.separateSideAndBpOrder) return 'BLUE';
    if (!state.bpFirstTeam) return 'BLUE';
    const side = state.sides?.[state.bpFirstTeam];
    return side || 'BLUE';
  })();

  // base 序列默认假设 BLUE 是“BP先手方”。若先手方实际为 RED，则整体翻转。
  const resolvedSide: Side = bpFirstSide === 'RED' ? (base.side === 'BLUE' ? 'RED' : 'BLUE') : base.side;

  return { ...base, side: resolvedSide, index: state.draftStepIndex };
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

  state.seriesHistory.forEach((game) => {
    game.bluePicks.forEach((id) => set.add(id));
    game.redPicks.forEach((id) => set.add(id));
  });
  return set;
};

// --- VALIDATION LOGIC ---
export const validateMove = (state: DraftState, payload: any): string | null => {
  const { actorRole, type, side, heroId } = payload;

  if (!actorRole) return 'Unauthorized: No role specified';
  if (actorRole === 'SPECTATOR') return 'Spectators cannot perform actions';

  if (['START_GAME', 'RESET_GAME', 'PAUSE_GAME', 'RESUME_GAME', 'REPORT_RESULT'].includes(type)) {
    if (actorRole !== 'REFEREE') return 'Only Referee can manage game state';
    if (type === 'START_GAME') {
      if (!state.sides.TEAM_A || !state.sides.TEAM_B) return 'Sides not selected yet';
      if (state.separateSideAndBpOrder && !state.bpFirstTeam) return 'BP priority not selected yet';
      if (!state.blueReady || !state.redReady) return 'Both teams must be READY to start';
    }
    return null;
  }

  if (type === 'SET_SIDES') {
    if (state.status !== 'NOT_STARTED') return 'Cannot set sides after game started';
    const selector = state.nextSideSelector || 'REFEREE';
    if (actorRole !== selector && actorRole !== 'REFEREE') {
      return `Waiting for ${selector} to select sides`;
    }
    if (state.separateSideAndBpOrder) {
      const bpFirstTeam = payload.bpFirstTeam as TeamId | undefined;
      if (bpFirstTeam !== 'TEAM_A' && bpFirstTeam !== 'TEAM_B') {
        return 'BP priority not selected yet';
      }
    }
    return null;
  }

  if (type === 'TOGGLE_READY') {
    if (state.status !== 'NOT_STARTED') return 'Cannot toggle ready after game started';
    if (!state.sides.TEAM_A) return 'Sides must be set before ready';
    if (state.separateSideAndBpOrder && !state.bpFirstTeam) return 'BP priority must be set before ready';
    return null;
  }

  if (state.paused) return `Game is paused (${state.pauseReason})`;

  if (state.status !== 'RUNNING') return `Game is ${state.status}`;
  if (actorRole === 'REFEREE') return null;

  const actorSide = getSideFromRole(state, actorRole);
  if (!actorSide) return 'You are not assigned a side';

  if (state.phase === 'DRAFT') {
    const currentStep = getCurrentStep(state);
    if (!currentStep) return 'Draft finished';
    if (currentStep.side !== actorSide) return `Not your turn`;

    // Fearless Check
    if (heroId && state.draftMode === 'FEARLESS') {
      if (heroId !== SPECIAL_ID_NONE && heroId !== SPECIAL_ID_RANDOM) {
        const fearlessBans = getFearlessBannedIds(state);
        if (fearlessBans.has(heroId)) {
          return 'Hero unavailable in Global Fearless mode (picked in previous game)';
        }
      }
    }

    return null;
  }

  if (state.phase === 'SWAP') {
    if (type === 'SWAP') {
      if (payload.side !== actorSide) return 'Wrong side';
      return null;
    }
  }

  return 'Invalid action';
};

const reduceState = (state: DraftState, action: DraftAction): DraftState => {
  const newState = { ...state };
  newState.lastActionSeq = action.seq;

  switch (action.type) {
    case 'SET_SIDES':
      const sideA = action.payload.sideForA as Side;
      const sideB = sideA === 'BLUE' ? 'RED' : 'BLUE';
      newState.sides = { TEAM_A: sideA, TEAM_B: sideB };
      // 开启分离时，需要同时记录 BP 先手队伍 (TEAM_A / TEAM_B)
      if (newState.separateSideAndBpOrder) {
        const bp = action.payload.bpFirstTeam as TeamId | undefined;
        newState.bpFirstTeam = bp === 'TEAM_A' || bp === 'TEAM_B' ? bp : null;
      } else {
        newState.bpFirstTeam = null;
      }
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
        redPicks: state.redPicks,
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
        newState.blueBans = [];
        newState.redBans = [];
        newState.bluePicks = [];
        newState.redPicks = [];
        newState.blueReady = false;
        newState.redReady = false;
        newState.stepEndsAt = 0;
        newState.bpFirstTeam = null;

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
        timeLimit: state.timeLimit,
        separateSideAndBpOrder: state.separateSideAndBpOrder,
        bpFirstTeam: null,
        teamA: { ...state.teamA, wins: 0 },
        teamB: { ...state.teamB, wins: 0 },
        lastActionSeq: action.seq,
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
};

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
      payload: payload,
    };
  } else if (state.status === 'RUNNING' && !state.paused) {
    const currentStep = getCurrentStep(state);

    if (state.phase === 'DRAFT') {
      if (currentStep) {
        let resolvedHeroId = payload.heroId;
        if (resolvedHeroId === SPECIAL_ID_RANDOM) {
          const usedHeroes = new Set([...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks]);
          const fearlessBans = getFearlessBannedIds(state);

          const available = HERO_IDS.filter((id) => !usedHeroes.has(id) && !fearlessBans.has(id));
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
          actorRole: payload.actorRole,
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
          actorRole: payload.actorRole,
        };
      } else if (payload.type === 'FINISH_SWAP') {
        action = { seq: nextSeq, stepIndex: state.stepIndex, type: 'FINISH_SWAP', actorRole: payload.actorRole };
      }
    }
  }

  if (!action) return state;

  const newState = reduceState(state, action);

  // 计算持续时间：如果 timeLimit 是 0，则 duration 为 0
  const duration = (state.timeLimit || 0) * 1000;

  if (action.type === 'PAUSE_GAME') {
    if (!state.paused) newState.pausedAt = now;
    else newState.pausedAt = state.pausedAt;
  } else if (action.type === 'RESUME_GAME') {
    if (state.pausedAt) {
      // 恢复时，把暂停的时间补回来
      newState.stepEndsAt = state.stepEndsAt + (now - state.pausedAt);
      newState.pausedAt = undefined;
    }
  } else if (newState.status === 'RUNNING' && newState.phase !== 'FINISHED' && !newState.paused) {
    // 只有在这些动作发生时，才重置倒计时
    const shouldResetTimer =
      action.type === 'START_GAME' ||
      (state.phase === 'DRAFT' && newState.phase === 'DRAFT') || // Ban/Pick 动作
      (state.phase === 'DRAFT' && newState.phase === 'SWAP'); // 进入 Swap 阶段

    if (shouldResetTimer) {
      // 如果 duration > 0，则设置截止时间；否则设为 0 (无上限)
      newState.stepEndsAt = duration > 0 ? now + duration : 0;
    } else {
      // Swap 内部动作不重置时间
      newState.stepEndsAt = state.stepEndsAt;
    }
  } else if (newState.phase === 'FINISHED') {
    newState.stepEndsAt = 0;
  }

  newState.history = [...state.history, action];
  return newState;
};

export const replay = (history: DraftAction[], now: number, seedConfig?: DraftState | null): DraftState => {
  // ✅ Undo/重放时保留“无法从 history 推导”的配置项
  const base: DraftState = {
    ...INITIAL_STATE,
    matchTitle: seedConfig?.matchTitle ?? INITIAL_STATE.matchTitle,
    seriesMode: seedConfig?.seriesMode ?? INITIAL_STATE.seriesMode,
    draftMode: seedConfig?.draftMode ?? INITIAL_STATE.draftMode,
    timeLimit: seedConfig?.timeLimit ?? INITIAL_STATE.timeLimit,
    separateSideAndBpOrder: seedConfig?.separateSideAndBpOrder ?? INITIAL_STATE.separateSideAndBpOrder,
    bpFirstTeam: null,
    teamA: { name: seedConfig?.teamA?.name ?? INITIAL_STATE.teamA.name, wins: 0 },
    teamB: { name: seedConfig?.teamB?.name ?? INITIAL_STATE.teamB.name, wins: 0 },
  };

  let state = { ...base };
  for (const action of history) {
    state = reduceState(state, action);
  }
  state.history = history;

  const duration = (state.timeLimit || 0) * 1000;

  if (state.status === 'RUNNING' && state.phase !== 'FINISHED' && !state.paused) {
    state.stepEndsAt = duration > 0 ? now + duration : 0;
  } else {
    state.stepEndsAt = 0;
  }
  return state;
};
