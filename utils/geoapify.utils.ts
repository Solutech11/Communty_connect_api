import { createHash } from "node:crypto";
import axios from "axios";
import { env } from "../Config/env";
import type { LocationReverseQuery, LocationSearchQuery } from "../schemas/location.schemas";
import { AppError } from "./AppError";
import { logger } from "./logger.utils";

export interface LocationSuggestion {
  id: string;
  name: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  state: string | null;
  localArea: string | null;
}

const stringField = (value: unknown): string | null => (
  typeof value === "string" && value.trim() ? value.trim() : null
);

export const mapGeoapifyResult = (value: unknown): LocationSuggestion | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const label = stringField(result.formatted);
  const latitude = result.lat;
  const longitude = result.lon;
  if (!label || typeof latitude !== "number" || !Number.isFinite(latitude)
    || latitude < -90 || latitude > 90 || typeof longitude !== "number"
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  // Geoapify normally supplies place_id. A deterministic fallback keeps the
  // app's list keys stable when a provider result omits it.
  const id = stringField(result.place_id) || createHash("sha256")
    .update(`${label}\u0000${latitude}\u0000${longitude}`)
    .digest("hex");

  return {
    id,
    name: stringField(result.name) || stringField(result.address_line1) || label,
    label,
    address: stringField(result.address_line2) || label,
    latitude,
    longitude,
    state: stringField(result.state),
    localArea: stringField(result.county) || stringField(result.district),
  };
};

export const searchGeoapifyLocations = async (
  query: LocationSearchQuery,
): Promise<LocationSuggestion[]> => {
  if (!env.GEOAPIFY_API_KEY) {
    throw new AppError(503, "Location search is unavailable", "LOCATION_SEARCH_UNAVAILABLE");
  }

  const params: Record<string, string | number> = {
    text: query.q,
    format: "json",
    limit: query.limit,
    apiKey: env.GEOAPIFY_API_KEY,
  };
  if (query.countryCode) params.filter = `countrycode:${query.countryCode.toLowerCase()}`;
  if (query.latitude !== undefined && query.longitude !== undefined) {
    params.bias = `proximity:${query.longitude},${query.latitude}`;
  }

  try {
    const response = await axios.get<unknown>("https://api.geoapify.com/v1/geocode/autocomplete", {
      params,
      timeout: 5_000,
      maxRedirects: 0,
      headers: { Accept: "application/json" },
    });
    const payload = response.data;
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
      throw new AppError(502, "Location search is temporarily unavailable", "LOCATION_PROVIDER_INVALID_RESPONSE");
    }
    return ((payload as { results: unknown[] }).results)
      .slice(0, query.limit)
      .map(mapGeoapifyResult)
      .filter((result): result is LocationSuggestion => result !== null);
  } catch (error) {
    // Never log Axios errors: their request configuration can contain apiKey.
    logger.warn({
      provider: "geoapify",
      operation: "autocomplete",
      providerStatus: axios.isAxiosError(error) ? error.response?.status : undefined,
    }, "Geoapify location search failed");
    if (error instanceof AppError) throw error;
    throw new AppError(502, "Location search is temporarily unavailable", "LOCATION_PROVIDER_UNAVAILABLE");
  }
};

export const reverseGeoapifyState = async (query: LocationReverseQuery): Promise<string | null> => {
  if (!env.GEOAPIFY_API_KEY) {
    throw new AppError(503, "Location lookup is unavailable", "LOCATION_SEARCH_UNAVAILABLE");
  }
  try {
    const response = await axios.get<unknown>("https://api.geoapify.com/v1/geocode/reverse", {
      params: {
        lat: query.latitude,
        lon: query.longitude,
        format: "json",
        apiKey: env.GEOAPIFY_API_KEY,
      },
      timeout: 5_000,
      maxRedirects: 0,
      headers: { Accept: "application/json" },
    });
    const payload = response.data;
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
      throw new AppError(502, "Location lookup is temporarily unavailable", "LOCATION_PROVIDER_INVALID_RESPONSE");
    }
    const first = (payload as { results: unknown[] }).results[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) return null;
    return stringField((first as Record<string, unknown>).state);
  } catch (error) {
    logger.warn({
      provider: "geoapify",
      operation: "reverse",
      providerStatus: axios.isAxiosError(error) ? error.response?.status : undefined,
    }, "Geoapify reverse lookup failed");
    if (error instanceof AppError) throw error;
    throw new AppError(502, "Location lookup is temporarily unavailable", "LOCATION_PROVIDER_UNAVAILABLE");
  }
};
