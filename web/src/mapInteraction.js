export function normalizeMapPick(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError("Latitude must be a finite number between -90 and 90");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError("Longitude must be a finite number between -180 and 180");
  }
  return { lat: latitude, lng: longitude };
}

export function mapPickFromGeolocation(position) {
  if (!position?.coords) throw new TypeError("Geolocation coordinates are required");
  return normalizeMapPick(position.coords.latitude, position.coords.longitude);
}
