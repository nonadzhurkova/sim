/**
 * Latitude/longitude per circuit, keyed by circuits.externalRef (the
 * Jolpica/Ergast circuitId). Static lookup -- the calendar's venues change
 * rarely enough that hand-maintaining this list is simpler and more
 * reliable than geocoding a circuit name at request time, and avoids a
 * second external API dependency just to resolve a location.
 *
 * Coordinates point at the circuit itself (start/finish line area), not the
 * host city, since local weather can differ meaningfully from the nearest
 * city's forecast (e.g. Spa's microclimate vs. nearby towns).
 */
export const CIRCUIT_COORDINATES: Record<string, { lat: number; lon: number }> = {
  albert_park: { lat: -37.8497, lon: 144.968 },
  imola: { lat: 44.3439, lon: 11.7167 },
  monza: { lat: 45.6156, lon: 9.2811 },
  rodriguez: { lat: 19.4042, lon: -99.0907 },
  interlagos: { lat: -23.7036, lon: -46.6997 },
  bahrain: { lat: 26.0325, lon: 50.5106 },
  baku: { lat: 40.3725, lon: 49.8533 },
  villeneuve: { lat: 45.5, lon: -73.5228 },
  zandvoort: { lat: 52.3888, lon: 4.5409 },
  catalunya: { lat: 41.57, lon: 2.2611 },
  monaco: { lat: 43.7347, lon: 7.4206 },
  spa: { lat: 50.4372, lon: 5.9714 },
  americas: { lat: 30.1328, lon: -97.6411 },
  hungaroring: { lat: 47.5789, lon: 19.2486 },
  jeddah: { lat: 21.6319, lon: 39.1044 },
  vegas: { lat: 36.1147, lon: -115.1728 },
  losail: { lat: 25.49, lon: 51.4542 },
  madring: { lat: 40.4259, lon: -3.5869 },
  marina_bay: { lat: 1.2914, lon: 103.864 },
  miami: { lat: 25.9581, lon: -80.2389 },
  red_bull_ring: { lat: 47.2197, lon: 14.7647 },
  sepang: { lat: 2.7608, lon: 101.7383 },
  shanghai: { lat: 31.3389, lon: 121.2197 },
  silverstone: { lat: 52.0786, lon: -1.0169 },
  suzuka: { lat: 34.8431, lon: 136.5407 },
  yas_marina: { lat: 24.4672, lon: 54.6031 },
};
