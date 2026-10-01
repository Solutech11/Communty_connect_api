import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import type { Request, Response } from "express";
import "./test-env";
import { redisClient } from "../DB/redis";
import { bankAccountDetailsSchema } from "../schemas/bankAccount.schemas";
import { resolveWalletBankAccount } from "../utils/bankAccount.utils";
import { AppError } from "../utils/AppError";
import { addBankAccount, resolveBankAccount } from "../Controller/wallet.controller";
import { BankAccountModel } from "../models/Wallet/BankAccount.model";

const bank = { name: "Fixture Bank", code: "058", active: true, currency: "NGN" };
const details = { accountNumber: "0123456789", bankCode: "058" };
const responseRecorder = () => {
  let status = 0;
  let body: unknown;
  const response = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  return { response, status: () => status, body: () => body };
};

test("bank details require a bank and exactly 10 digits, with no client-supplied name", () => {
  assert.equal(bankAccountDetailsSchema.safeParse(details).success, true);
  for (const input of [
    { ...details, accountNumber: "123456789" },
    { ...details, accountNumber: "012345678x" },
    { ...details, bankCode: "" },
    { ...details, bankCode: "abc" },
    { ...details, accountName: "UNVERIFIED NAME" },
  ]) {
    assert.equal(bankAccountDetailsSchema.safeParse(input).success, false);
  }
});

test("account preview uses cached banks, returns a masked name and creates no recipient or record", async (context) => {
  context.mock.getter(redisClient, "isReady", () => true);
  context.mock.method(redisClient, "get", async () => JSON.stringify([bank]));
  const writes = context.mock.method(BankAccountModel, "findOneAndUpdate", () => {
    throw new Error("Preview must not save a bank account");
  });
  const requests = context.mock.method(axios.Axios.prototype, "request", async (config: { url: string }) => {
    assert.equal(config.url, "/bank/resolve");
    return { data: { status: true, data: { account_name: " ADA OKAFOR ", account_number: details.accountNumber } } };
  });
  const recorder = responseRecorder();
  await resolveBankAccount({ body: details } as Request, recorder.response);
  assert.equal(recorder.status(), 200);
  assert.deepEqual(recorder.body(), {
    success: true, message: "Bank account resolved",
    data: { resolution: { bankCode: "058", bankName: "Fixture Bank", accountName: "ADA OKAFOR", maskedAccountNumber: "******6789" } },
  });
  assert.equal(requests.mock.callCount(), 1);
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(JSON.stringify(recorder.body()).includes(details.accountNumber), false);
});

test("inactive or unknown bank is rejected before account resolution", async (context) => {
  context.mock.getter(redisClient, "isReady", () => true);
  context.mock.method(redisClient, "get", async () => JSON.stringify([{ ...bank, active: false }]));
  const requests = context.mock.method(axios.Axios.prototype, "request", async () => {
    throw new Error("Inactive banks must never reach the resolver");
  });
  await assert.rejects(resolveWalletBankAccount(details.accountNumber, details.bankCode),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_BANK_CODE");
  assert.equal(requests.mock.callCount(), 0);
});

test("resolver rejects mismatched account digits, empty names and malformed provider responses", async (context) => {
  for (const data of [
    { account_number: "9876543210", account_name: "ADA OKAFOR" },
    { account_number: details.accountNumber, account_name: " " },
    { account_number: details.accountNumber },
    null,
  ]) {
    await context.test("rejects unverified provider details", async (child) => {
      child.mock.getter(redisClient, "isReady", () => true);
      child.mock.method(redisClient, "get", async () => JSON.stringify([bank]));
      child.mock.method(axios.Axios.prototype, "request", async () => ({ data: { status: true, data } }));
      await assert.rejects(resolveWalletBankAccount(details.accountNumber, details.bankCode),
        (error: unknown) => error instanceof AppError && error.code === "INVALID_BANK_PROVIDER_RESPONSE");
    });
  }
});

test("saving independently resolves again and uses the new server-verified name", async (context) => {
  context.mock.getter(redisClient, "isReady", () => true);
  context.mock.method(redisClient, "get", async () => JSON.stringify([bank]));
  context.mock.method(BankAccountModel, "findOne", async () => null);
  let resolutions = 0;
  let recipientName = "";
  context.mock.method(axios.Axios.prototype, "request", async (config: { url: string; data?: { name: string } }) => {
    if (config.url === "/bank/resolve") {
      resolutions += 1;
      return { data: { status: true, data: { account_number: details.accountNumber, account_name: resolutions === 1 ? "PREVIEW NAME" : "CURRENT NAME" } } };
    }
    assert.equal(config.url, "/transferrecipient");
    recipientName = config.data!.name;
    return { data: { status: true, data: { recipient_code: "RCP_fixture" } } };
  });
  const writes = context.mock.method(BankAccountModel, "findOneAndUpdate", async (_query: unknown, update: { $set: { accountName: string; encryptedAccountNumber: string } }) => {
    assert.equal(update.$set.accountName, "CURRENT NAME");
    assert.notEqual(update.$set.encryptedAccountNumber, details.accountNumber);
    return { accountName: update.$set.accountName, maskedAccountNumber: "******6789" };
  });
  await resolveWalletBankAccount(details.accountNumber, details.bankCode);
  const recorder = responseRecorder();
  await addBankAccount({ body: details, auth: { id: "fixture-user" } } as Request, recorder.response);
  assert.equal(resolutions, 2);
  assert.equal(recipientName, "CURRENT NAME");
  assert.equal(writes.mock.callCount(), 1);
  assert.equal(recorder.status(), 201);
});
