import { initialCityRace } from './city-driving';
import { initialRace } from './racing-physics';
import { isCityRoute, type RouteId } from './route-registry';
import { configureVehicle } from './vehicles/state';
import type { VehicleId } from './vehicles/config';
import { isTrackId } from './tracks/registry';
import { initialTrackRace } from './tracks/physics';
export function initialPlayableState(routeId: RouteId, vehicleId?: VehicleId) {
  if (isTrackId(routeId)) return initialTrackRace(routeId, vehicleId);
  const state = isCityRoute(routeId) ? initialCityRace(routeId) : initialRace();
  return vehicleId ? configureVehicle(state, vehicleId) : state;
}
