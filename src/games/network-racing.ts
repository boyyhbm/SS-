import { initialRace, stepRace, type RaceState, type RaceInput } from './racing-physics';
import { resolveVehicleContacts } from './vehicle-contacts';
import { initialCityRace, stepCityRace, type CityRaceState } from './city-driving';
import { getRoute, isCityRoute, type RouteSelection } from './route-registry';
import { configureVehicle } from './vehicles/state';
import type { VehicleId } from './vehicles/config';
import { isTrackId } from './tracks/registry';
import { initialTrackRace, stepTrackRace, type TrackRaceState } from './tracks/physics';
export function initialNetworkRace(
  slot: number,
  config?: RouteSelection,
  vehicleId?: VehicleId,
): RaceState {
  const id = config?.routeId ?? 'legacy-circuit',
    r = getRoute(id),
    start = r.grid[slot % r.maxPlayers];
  const state = Object.assign(
    isTrackId(id)
      ? initialTrackRace(id, vehicleId)
      : isCityRoute(id)
        ? initialCityRace(id)
        : initialRace(),
    start,
  );
  return vehicleId ? configureVehicle(state, vehicleId) : state;
}
export function stepNetworkRace(
  state: RaceState,
  input: RaceInput,
  dt: number,
  config?: RouteSelection,
) {
  if (config && isTrackId(config.routeId))
    return stepTrackRace(state as TrackRaceState, input, dt, false, config.laps);
  if (config && isCityRoute(config.routeId)) {
    let lap: number | null = null,
      collision = false,
      impulse = 0;
    const steps = config.carContacts ? 3 : 1;
    for (let i = 0; i < steps; i++) {
      const result = stepCityRace(state as CityRaceState, input, dt / steps, false, config.laps);
      if (result !== null) lap = result;
      collision ||= state.collision;
      impulse += (state as CityRaceState).collisionImpulse;
    }
    state.collision = collision;
    (state as CityRaceState).collisionImpulse = impulse;
    return lap;
  }
  return stepRace(state, input, dt);
}
export function simulateNetworkGroup(
  players: { state: RaceState; input: RaceInput }[],
  dt: number,
  config?: RouteSelection,
) {
  if (!config?.carContacts || !isCityRoute(config.routeId)) {
    for (const p of players) stepNetworkRace(p.state, p.input, dt, config);
    return 0;
  }
  const subConfig = { ...config, carContacts: false },
    states = players.map((p) => p.state as CityRaceState);
  let contacts = 0;
  const impacts = states.map(() => ({ collision: false, impulse: 0 }));
  for (let i = 0; i < 3; i++) {
    for (const p of players) stepNetworkRace(p.state, p.input, dt / 3, subConfig);
    contacts += resolveVehicleContacts(states);
    states.forEach((s, j) => {
      impacts[j].collision ||= s.collision;
      impacts[j].impulse += s.collisionImpulse;
    });
  }
  states.forEach((s, j) => {
    s.collision = impacts[j].collision;
    s.collisionImpulse = impacts[j].impulse;
  });
  return contacts;
}
