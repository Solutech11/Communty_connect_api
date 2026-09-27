import type { Request, Response } from "express";
import { locationReverseQuerySchema, locationSearchQuerySchema } from "../schemas/location.schemas";
import { reverseGeoapifyState, searchGeoapifyLocations } from "../utils/geoapify.utils";
import { sendSuccess } from "../utils/response.utils";

export const searchLocations = async (request: Request, response: Response): Promise<void> => {
  // Express 5 exposes query through a getter, so route validation does not
  // persist transformed values (including the eight-result limit cap).
  const query = locationSearchQuerySchema.parse(request.query);
  const results = await searchGeoapifyLocations(query);
  sendSuccess(response, 200, "Location suggestions loaded.", {
    results,
    attribution: "Powered by Geoapify · © OpenStreetMap contributors",
  });
};

export const reverseLocation = async (request: Request, response: Response): Promise<void> => {
  const query = locationReverseQuerySchema.parse(request.query);
  const state = await reverseGeoapifyState(query);
  sendSuccess(response, 200, "State lookup complete.", {
    state,
    attribution: "Powered by Geoapify · © OpenStreetMap contributors",
  });
};
