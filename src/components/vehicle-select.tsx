'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { vehicles, type VehicleId, getVehicle } from '@/games/vehicles/config';
import { useGaragePreference } from '@/games/vehicles/preferences';
const Garage = dynamic(() => import('./vehicle-garage').then((m) => m.VehicleGarage), {
  ssr: false,
});
export function VehicleSelect({
  language,
  onSelect,
}: {
  language: 'ru' | 'en';
  onSelect?: (id: VehicleId) => void;
}) {
  const garage = useGaragePreference(),
    v = getVehicle(garage.value.vehicleId);
  const [open, setOpen] = useState(false);
  return (
    <div className="vehicle-select">
      <label>
        {language === 'ru' ? 'Автомобиль' : 'Vehicle'}
        <select
          aria-label={language === 'ru' ? 'Автомобиль' : 'Vehicle'}
          value={v.vehicleId}
          disabled={garage.busy}
          onChange={async (e) => {
            const id = e.target.value as VehicleId;
            if (await garage.save(id)) onSelect?.(id);
          }}
        >
          {vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {v.displayName} · {v.drivetrain}
            </option>
          ))}
        </select>
      </label>
      <small>
        {v.mass} kg · {v.power} kW · {v.description[language]}
      </small>
      <button className="button secondary garage-open" onClick={() => setOpen(true)}>
        {language === 'ru' ? 'Открыть гараж' : 'Open Garage'}
      </button>
      {open && <Garage language={language} onSelect={onSelect} onClose={() => setOpen(false)} />}
      {garage.error && (
        <span role="status">
          {language === 'ru' ? 'Не удалось сохранить выбор' : 'Could not save selection'}
        </span>
      )}
    </div>
  );
}
