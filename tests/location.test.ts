import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { UserModel } from "../models/Auth/User.model";

test("user locations are either absent or complete GeoJSON points", () => {
  const withoutLocation = new UserModel({
    firstName: "Ada",
    lastName: "Okafor",
    email: "ada@example.com",
    passwordHash: "hash",
  });
  const withLocation = new UserModel({
    firstName: "Chidi",
    lastName: "Eze",
    email: "chidi@example.com",
    passwordHash: "hash",
    location: { type: "Point", coordinates: [3.3792, 6.5244] },
  });

  assert.equal(withoutLocation.toObject().location, undefined);
  assert.deepEqual(withLocation.toObject().location, {
    type: "Point",
    coordinates: [3.3792, 6.5244],
  });
});
