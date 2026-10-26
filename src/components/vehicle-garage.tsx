'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Gauge } from 'lucide-react';
import { Modal } from './modal';
import { vehicles, getVehicle, type VehicleId } from '@/games/vehicles/config';
import { useGaragePreference, type GaragePreference } from '@/games/vehicles/preferences';
import measurements from '@/games/vehicles/benchmarks.json';
const Viewer = dynamic(() => import('./garage-viewer'), { ssr: false });
const classes = {
  'street-coupe': ['Спортивное купе', 'Street Coupe'],
  'hot-hatch': ['Горячий хэтчбек', 'Hot Hatch'],
  muscle: ['Маслкар', 'Muscle'],
  'awd-performance': ['Спортивный AWD', 'AWD Performance'],
  'track-supercar': ['Трековый суперкар', 'Track Supercar'],
  hypercar: ['Гиперкар', 'Hypercar'],
} as const;
export function VehicleGarage({
  language,
  onClose,
  onSelect,
}: {
  language: 'ru' | 'en';
  onClose: () => void;
  onSelect?: (id: VehicleId) => void;
}) {
  const garage = useGaragePreference(),
    [id, setId] = useState(garage.value.vehicleId),
    [paint, setPaint] = useState<GaragePreference['paint']>(garage.value.paint),
    [orbit, setOrbit] = useState(0);
  const car = getVehicle(id),
    stats = measurements.results.find((v) => v.vehicleId === id)!,
    max = (key: 'maximumSpeedKmh' | 'steeringHeadingChangeRad' | 'tireGrip') =>
      Math.max(...measurements.results.map((v) => v[key]));
  const metrics = [
    [
      language === 'ru' ? 'Скорость' : 'Speed',
      stats.maximumSpeedKmh / max('maximumSpeedKmh'),
      `${Math.round(stats.maximumSpeedKmh)} km/h`,
    ],
    [
      language === 'ru' ? 'Разгон 0–100' : '0–100 acceleration',
      2.8 / (stats.zeroTo100Seconds || 100),
      `${stats.zeroTo100Seconds?.toFixed(2)} s`,
    ],
    [
      language === 'ru' ? 'Реакция на руль' : 'Steering response',
      stats.steeringHeadingChangeRad / max('steeringHeadingChangeRad'),
      `${((stats.steeringHeadingChangeRad * 180) / Math.PI).toFixed(1)}° / 0.25 s`,
    ],
    [
      language === 'ru' ? 'Торможение 100–0' : '100–0 braking',
      Math.min(...measurements.results.map((v) => v.braking100Meters)) / stats.braking100Meters,
      `${stats.braking100Meters.toFixed(1)} m`,
    ],
    [
      language === 'ru' ? 'Сцепление' : 'Grip',
      stats.tireGrip / max('tireGrip'),
      `${stats.tireGrip.toFixed(2)} μ`,
    ],
  ] as const;
  return (
    <Modal
      title={language === 'ru' ? 'Гараж' : 'Garage'}
      closeLabel={language === 'ru' ? 'Закрыть гараж' : 'Close garage'}
      onClose={onClose}
    >
      <div className="vehicle-garage">
        <div className="garage-stage">
          <div className="garage-car-title">
            <span>{classes[car.vehicleClass][language === 'ru' ? 0 : 1]}</span>
            <h2>{car.displayName}</h2>
          </div>
          <Viewer vehicleId={id} paint={paint} orbit={orbit} language={language} />
          <div className="garage-orbit">
            <button
              aria-label={language === 'ru' ? 'Повернуть автомобиль влево' : 'Rotate left'}
              onClick={() => setOrbit((v) => v - 1)}
            >
              <ArrowLeft size={18} />
            </button>
            <span>{language === 'ru' ? 'Осмотреть автомобиль' : 'Explore vehicle'}</span>
            <button
              aria-label={language === 'ru' ? 'Повернуть автомобиль вправо' : 'Rotate right'}
              onClick={() => setOrbit((v) => v + 1)}
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
        <div className="garage-details">
          <div className="garage-specs">
            <span>{car.drivetrain}</span>
            <span>{car.power} kW</span>
            <span>{car.mass} kg</span>
          </div>
          <p>{car.description[language]}</p>
          <div className="garage-metrics">
            {metrics.map(([name, value, label]) => (
              <label key={name}>
                <span>
                  {name}
                  <strong>{label}</strong>
                </span>
                <meter min={0} max={1} value={value} />
              </label>
            ))}
          </div>
          <div
            className="garage-paints"
            aria-label={language === 'ru' ? 'Цвет кузова' : 'Body color'}
          >
            {(['silver', 'violet', 'cyan'] as const).map((color) => (
              <button
                aria-label={color}
                aria-pressed={paint === color}
                className={`paint-${color}`}
                key={color}
                onClick={() => setPaint(color)}
              >
                {paint === color && <Check size={18} />}
              </button>
            ))}
          </div>
          <small>
            {language === 'ru'
              ? 'Показатели измерены в игровой физике: сухая ровная дорога, без нитро.'
              : 'Measured in-game on a flat, dry road, without nitro.'}
          </small>
          <button
            className="button primary"
            disabled={garage.busy}
            onClick={async () => {
              if (await garage.save(id, paint)) {
                onSelect?.(id);
                onClose();
              }
            }}
          >
            <Gauge size={18} />
            {language === 'ru' ? 'Выбрать автомобиль' : 'Select Vehicle'}
          </button>
          {garage.error && (
            <p role="alert">
              {language === 'ru'
                ? 'Не удалось сохранить. Попробуйте снова.'
                : 'Could not save. Please retry.'}
            </p>
          )}
        </div>
        <div className="garage-roster">
          {vehicles.map((v) => (
            <button
              data-garage-option={v.vehicleId}
              aria-pressed={id === v.vehicleId}
              key={v.vehicleId}
              onClick={() => setId(v.vehicleId)}
            >
              <span>{classes[v.vehicleClass][language === 'ru' ? 0 : 1]}</span>
              <strong>{v.displayName}</strong>
              <small>
                {v.drivetrain} · {v.power} kW
              </small>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
