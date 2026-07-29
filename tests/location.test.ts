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

test("user personalization fields have safe defaults and enforce supported values", async () => {
  const defaultUser = new UserModel({
    firstName: "Ada",
    lastName: "Okafor",
    email: "defaults@example.com",
    passwordHash: "hash",
  });
  const personalizedUser = new UserModel({
    firstName: "Chidi",
    lastName: "Eze",
    email: "personalized@example.com",
    passwordHash: "hash",
    preferredSetting: "outdoor",
    preferredGroupSize: "large",
    participationRole: "organizer",
    hobbies: ["photography", "cooking"],
  });
  const invalidUser = new UserModel({
    firstName: "Ngozi",
    lastName: "Okafor",
    email: "invalid@example.com",
    passwordHash: "hash",
    preferredSetting: "hybrid",
    preferredGroupSize: "crowd",
    participationRole: "admin",
  });

  assert.equal(defaultUser.preferredSetting, "indoor");
  assert.equal(defaultUser.preferredGroupSize, "medium");
  assert.equal(defaultUser.participationRole, "participant");
  assert.deepEqual(defaultUser.hobbies, []);

  await personalizedUser.validate();
  assert.deepEqual(personalizedUser.hobbies, ["photography", "cooking"]);

  await assert.rejects(invalidUser.validate(), (error: unknown) => {
    const errors = (error as { errors?: Record<string, unknown> }).errors;
    assert.ok(errors?.preferredSetting);
    assert.ok(errors?.preferredGroupSize);
    assert.ok(errors?.participationRole);
    return true;
  });
});
