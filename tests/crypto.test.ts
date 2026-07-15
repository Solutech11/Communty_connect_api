import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import {
  decryptField,
  encryptField,
  hashOtp,
  maskAccountNumber,
  secureEqual,
  sha256,
} from "../utils/crypto.utils";

test("field encryption is authenticated, non-deterministic, and reversible", () => {
  const first = encryptField("0123456789");
  const second = encryptField("0123456789");

  assert.notEqual(first, second);
  assert.equal(decryptField(first), "0123456789");
  assert.equal(decryptField(second), "0123456789");
});

test("security values are hashed and compared safely", () => {
  assert.equal(sha256("value").length, 64);
  assert.equal(hashOtp("123456").length, 64);
  assert.equal(secureEqual("same", "same"), true);
  assert.equal(secureEqual("same", "different"), false);
});

test("bank-account masks retain only the final four digits", () => {
  assert.equal(maskAccountNumber("0123456789"), "******6789");
});
