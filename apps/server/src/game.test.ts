import assert from 'assert';
import {
  applyAction,
  createReplayBase,
  DraftState,
  INITIAL_STATE,
  replay,
  SPECIAL_ID_NONE,
  validateMove,
} from './game';

const now = 1_000_000;

const withSidesReady = (state: DraftState): DraftState => ({
  ...state,
  sides: { TEAM_A: 'BLUE', TEAM_B: 'RED' },
  blueReady: true,
  redReady: true,
});

const baseMatch: DraftState = {
  ...INITIAL_STATE,
  matchTitle: 'Regression Cup',
  seriesMode: 'BO3',
  draftMode: 'STANDARD',
  teamA: { name: 'Alpha', wins: 0 },
  teamB: { name: 'Beta', wins: 0 },
};

let state = withSidesReady(baseMatch);
state = applyAction(state, { type: 'START_GAME', actorRole: 'REFEREE' }, now);
state = applyAction(state, { heroId: 'aatrox', actorRole: 'TEAM_A' }, now + 1);

assert.equal(
  validateMove(state, { heroId: 'aatrox', actorRole: 'TEAM_B' }),
  'Hero already used',
  'server rejects duplicate hero submissions'
);

const pickState = {
  ...state,
  draftStepIndex: 6,
  stepIndex: 6,
  blueBans: ['aatrox', 'ahri', 'akali'],
  redBans: ['annie', 'ashe', 'azir'],
};

assert.equal(
  validateMove(pickState, { heroId: SPECIAL_ID_NONE, actorRole: 'TEAM_A' }),
  'NO BAN can only be used during ban phases',
  'server rejects NO BAN during pick phases'
);

const replayed = replay(state.history.slice(0, -1), now + 2, createReplayBase(state));
assert.equal(replayed.matchTitle, 'Regression Cup', 'undo replay preserves match title');
assert.equal(replayed.seriesMode, 'BO3', 'undo replay preserves series mode');
assert.equal(replayed.teamA.name, 'Alpha', 'undo replay preserves Team A name');
assert.equal(replayed.teamB.name, 'Beta', 'undo replay preserves Team B name');

console.log('game logic tests passed');

assert.equal(validateMove(state, null), 'Invalid action payload');
assert.equal(validateMove(state, { actorRole: 'ADMIN', heroId: 'ahri' }), 'Unknown role');
assert.equal(validateMove(state, { actorRole: 'REFEREE', type: 'SWAP', heroId: 'ahri' }), 'Invalid action for current step');
assert.equal(validateMove(state, { actorRole: 'TEAM_A', type: 'TOGGLE_READY', side: 'RED' }), 'Cannot toggle ready after game started');

let complete = withSidesReady({ ...baseMatch, draftMode: 'FEARLESS' });
complete = applyAction(complete, { type: 'START_GAME', actorRole: 'REFEREE' }, now);
for (let i = 0; i < 20; i++) {
  complete = applyAction(complete, { heroId: 'special_random', actorRole: 'REFEREE' }, now + i + 1);
}
assert.equal(complete.phase, 'SWAP');
assert.equal(new Set([...complete.blueBans, ...complete.redBans, ...complete.bluePicks, ...complete.redPicks]).size, 20);
complete = applyAction(complete, { type: 'FINISH_SWAP', actorRole: 'REFEREE' }, now + 30);
const previous = complete;
complete = applyAction(complete, { type: 'REPORT_RESULT', actorRole: 'REFEREE', winner: 'TEAM_A' }, now + 31);
assert.equal(previous.teamA.wins, 0, 'result reducer preserves prior state');
assert.equal(complete.currentGameIdx, 2);
assert.equal(complete.teamA.wins, 1);
assert.equal(complete.nextSideSelector, 'TEAM_B');
const fearlessNext = applyAction(withSidesReady(complete), { type: 'START_GAME', actorRole: 'REFEREE' }, now + 32);
assert.match(validateMove(fearlessNext, { heroId: previous.bluePicks[0], actorRole: 'REFEREE' }) || '', /Fearless/);
console.log('full draft, series and fearless tests passed');
