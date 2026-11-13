const { bad, mapsSearchUrl } = require("../lib/workshop-utils");
function configuration() {
  const httpsUrl = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password
        ? u.href
        : null;
    } catch {
      return null;
    }
  };
  return {
    enabled: process.env.GOOGLE_PLACES_ENABLED === "true",
    key: process.env.GOOGLE_PLACES_API_KEY || "",
    termsUrl: httpsUrl(process.env.APP_TERMS_URL),
    privacyUrl: httpsUrl(process.env.APP_PRIVACY_URL),
  };
}
function safeMapsUrl(value, id, name) {
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      ["www.google.com", "maps.google.com", "google.com"].includes(
        u.hostname,
      ) &&
      !u.username &&
      !u.password
    )
      return u.href;
  } catch {}
  return (
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(name) +
    "&query_place_id=" +
    encodeURIComponent(id)
  );
}
function createGooglePlacesClient({
  fetchImpl = fetch,
  config = configuration,
} = {}) {
  return {
    status() {
      const c = config();
      return {
        enabled: c.enabled,
        configured: Boolean(c.key),
        ready: Boolean(c.enabled && c.key && c.termsUrl && c.privacyUrl),
        termsUrl: c.termsUrl,
        privacyUrl: c.privacyUrl,
      };
    },
    async search(location, vehicleType) {
      const c = config();
      if (!this.status().ready)
        throw bad(
          "Pencarian Google Maps belum aktif. Konfigurasi server perlu disiapkan.",
          503,
          "GOOGLE_NOT_READY",
        );
      let response;
      try {
        response = await fetchImpl(
          vehicleType
            ? "https://places.googleapis.com/v1/places:searchText"
            : "https://places.googleapis.com/v1/places:searchNearby",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": c.key,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus,places.attributions,places.rating,places.userRatingCount",
            },
            body: JSON.stringify(
              vehicleType
                ? {
                    textQuery: "bengkel " + vehicleType,
                    pageSize: 20,
                    rankPreference: "DISTANCE",
                    languageCode: "id",
                    locationBias: {
                      circle: {
                        center: {
                          latitude: location.lat,
                          longitude: location.lng,
                        },
                        radius: 15000,
                      },
                    },
                  }
                : {
                    includedTypes: ["car_repair"],
                    maxResultCount: 20,
                    rankPreference: "DISTANCE",
                    languageCode: "id",
                    locationRestriction: {
                      circle: {
                        center: {
                          latitude: location.lat,
                          longitude: location.lng,
                        },
                        radius: 15000,
                      },
                    },
                  },
            ),
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch (error) {
        throw bad(
          error.name === "TimeoutError"
            ? "Google Maps melewati batas waktu."
            : "Google Maps tidak dapat dihubungi.",
          503,
          "GOOGLE_UNAVAILABLE",
        );
      }
      if (!response.ok)
        throw bad(
          "Pencarian Google Maps gagal. Periksa konfigurasi Places API di server.",
          503,
          "GOOGLE_PROVIDER_ERROR",
        );
      let body;
      try {
        body = await response.json();
      } catch {
        throw bad(
          "Respons Google Maps tidak valid.",
          502,
          "GOOGLE_INVALID_RESPONSE",
        );
      }
      if (body.places !== undefined && !Array.isArray(body.places))
        throw bad(
          "Respons Google Maps tidak valid.",
          502,
          "GOOGLE_INVALID_RESPONSE",
        );
      const seen = new Set();
      return (body.places || [])
        .filter(
          (p) =>
            p &&
            typeof p.id === "string" &&
            !seen.has(p.id) &&
            seen.add(p.id) &&
            p.businessStatus !== "CLOSED_PERMANENTLY" &&
            typeof p.displayName?.text === "string" &&
            typeof p.location?.latitude === "number" &&
            typeof p.location?.longitude === "number" &&
            Math.abs(p.location.latitude) <= 90 &&
            Math.abs(p.location.longitude) <= 180,
        )
        .map((p) => ({
          id: "google:" + p.id,
          googlePlaceId: p.id,
          name: p.displayName.text,
          address:
            typeof p.formattedAddress === "string" ? p.formattedAddress : "",
          lat: p.location.latitude,
          lng: p.location.longitude,
          googleMapsUrl: safeMapsUrl(p.googleMapsUri, p.id, p.displayName.text),
          source: "google_places",
          classification: "general",
          membershipStatus: "unmatched",
          isPartner: false,
          isDemo: false,
          rating:
            Number.isFinite(p.rating) && p.rating >= 0 && p.rating <= 5
              ? p.rating
              : null,
          reviews:
            Number.isSafeInteger(p.userRatingCount) && p.userRatingCount >= 0
              ? p.userRatingCount
              : null,
          vehicleTypes: [],
          vehicleQueryType: vehicleType || null,
          services: null,
          pickup: null,
          onsite: null,
          open24: null,
          emergency: null,
          emoji: "🔧",
          attributions: (Array.isArray(p.attributions)
            ? p.attributions
            : []
          ).map((a) => ({
            provider: typeof a.provider === "string" ? a.provider : "",
            providerUri:
              typeof a.providerUri === "string" &&
              a.providerUri.startsWith("https://")
                ? a.providerUri
                : null,
          })),
        }));
    },
  };
}
module.exports = { createGooglePlacesClient, configuration, safeMapsUrl };
