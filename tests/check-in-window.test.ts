import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Request, Response } from "express";
import "./test-env";
import { checkInTicket, verifyCheckInTicket } from "../Controller/event.controller";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { sha256 } from "../utils/crypto.utils";

const eventId = "507f1f77bcf86cd799439011";
const ownerId = "507f1f77bcf86cd799439012";
const qrToken = "check-in-window-test-token-1234567890";
const minute = 60 * 1000;

const request = {
  params: { id: eventId },
  auth: { id: ownerId },
  body: { qrToken },
} as unknown as Request;

const createResponse = () => {
  let statusCode: number | undefined;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as Response;
  return { response, getStatusCode: () => statusCode, getBody: () => body };
};

test("check-in does not use a ticket before the two-hour window or after the event ends", async () => {
  const now = Date.now();
  const cases = [
    {
      startsAt: new Date(now + 121 * minute),
      endsAt: new Date(now + 240 * minute),
      code: "CHECKIN_NOT_OPEN",
    },
    {
      startsAt: new Date(now - 240 * minute),
      endsAt: new Date(now - minute),
      code: "CHECKIN_CLOSED",
    },
  ];

  for (const checkInCase of cases) {
    const findEvent = mock.method(EventModel, "findOne", async () => ({
      _id: eventId,
      startsAt: checkInCase.startsAt,
      endsAt: checkInCase.endsAt,
    }));
    const updateTicket = mock.method(TicketOrderModel, "findOneAndUpdate", () => {
      throw new Error("Ticket must not be updated outside the check-in window");
    });

    try {
      const { response } = createResponse();
      await assert.rejects(checkInTicket(request, response), (error: unknown) => {
        const failure = error as { statusCode?: number; code?: string };
        assert.equal(failure.statusCode, 409);
        assert.equal(failure.code, checkInCase.code);
        return true;
      });
      assert.deepEqual(findEvent.mock.calls[0]?.arguments[0], { _id: eventId, creatorId: ownerId });
      assert.equal(updateTicket.mock.callCount(), 0);
    } finally {
      updateTicket.mock.restore();
      findEvent.mock.restore();
    }
  }
});

test("check-in accepts a paid unused ticket during the event window", async () => {
  const now = Date.now();
  const event = {
    _id: eventId,
    startsAt: new Date(now + 90 * minute),
    endsAt: new Date(now + 240 * minute),
  };
  let removedHash = false;
  const order = {
    set(field: string, value: unknown) {
      removedHash = field === "qrTokenHash" && value === undefined;
    },
  };
  const findEvent = mock.method(EventModel, "findOne", async () => event);
  const updateTicket = mock.method(TicketOrderModel, "findOneAndUpdate", () => ({
    select: async () => order,
  }));

  try {
    const { response, getStatusCode, getBody } = createResponse();
    await checkInTicket(request, response);

    assert.equal(updateTicket.mock.callCount(), 1);
    const [filter, update] = updateTicket.mock.calls[0]!.arguments as unknown as [
      Record<string, unknown>,
      { $set: { checkedInAt: Date; checkedInBy: string } },
    ];
    assert.deepEqual(filter, {
      eventId,
      qrTokenHash: sha256(qrToken),
      status: "paid",
      checkedInAt: { $exists: false },
    });
    assert.ok(update.$set.checkedInAt >= new Date(event.startsAt.getTime() - 2 * 60 * minute));
    assert.ok(update.$set.checkedInAt <= event.endsAt);
    assert.equal(update.$set.checkedInBy, ownerId);
    assert.equal(removedHash, true);
    assert.equal(getStatusCode(), 200);
    assert.deepEqual(getBody(), { success: true, message: "Ticket checked in", data: { order } });
  } finally {
    updateTicket.mock.restore();
    findEvent.mock.restore();
  }
});

test("QR preview returns the paid attendee and ticket without recording check-in", async () => {
  const now = Date.now();
  const eligibleEvent = {
    _id: eventId,
    title: "Community Meetup",
    startsAt: new Date(now + 90 * minute),
    endsAt: new Date(now + 240 * minute),
  };
  const checkedInAt = new Date(now - 5 * minute);
  const attendeeId = "507f1f77bcf86cd799439013";
  const orderId = "507f1f77bcf86cd799439014";
  const previewRequest = { ...request, params: { eventId } } as unknown as Request;
  const cases = [
    { event: eligibleEvent, priorCheckIn: null, canCheckIn: true },
    { event: eligibleEvent, priorCheckIn: checkedInAt, canCheckIn: false },
    { event: { ...eligibleEvent, startsAt: new Date(now + 121 * minute) }, priorCheckIn: null, canCheckIn: false },
    { event: { ...eligibleEvent, startsAt: new Date(now - 240 * minute), endsAt: new Date(now - minute) }, priorCheckIn: null, canCheckIn: false },
  ];

  for (const { event, priorCheckIn, canCheckIn } of cases) {
    const order = {
      _id: orderId,
      orderNumber: "CC-1784370000000-A1B2C3D4",
      quantity: 1,
      status: "paid",
      checkedInAt: priorCheckIn,
      buyerId: {
        _id: attendeeId,
        firstName: "Ada",
        lastName: "Okafor",
        email: "ada@example.com",
        avatarUrl: "https://example.com/ada.webp",
      },
      ticketTypeId: { title: "General Admission" },
    };
    const findEvent = mock.method(EventModel, "findOne", async () => event);
    const findTicket = mock.method(TicketOrderModel, "findOne", () => {
      const query = {
        select: () => query,
        populate: () => query,
        lean: async () => order,
      };
      return query;
    });
    const updateTicket = mock.method(TicketOrderModel, "findOneAndUpdate", () => {
      throw new Error("Preview must never update a ticket");
    });

    try {
      const { response, getStatusCode, getBody } = createResponse();
      await verifyCheckInTicket(previewRequest, response);
      const payload = getBody() as { data: Record<string, unknown> };

      assert.deepEqual(findEvent.mock.calls[0]?.arguments[0], { _id: eventId, creatorId: ownerId });
      assert.deepEqual(findTicket.mock.calls[0]?.arguments[0], {
        eventId,
        qrTokenHash: sha256(qrToken),
        status: "paid",
      });
      assert.equal(updateTicket.mock.callCount(), 0);
      assert.equal(getStatusCode(), 200);
      assert.deepEqual(payload.data, {
        status: "valid",
        canCheckIn,
        checkedInAt: priorCheckIn,
        event: { id: eventId, title: event.title },
        attendee: {
          id: attendeeId,
          name: "Ada Okafor",
          email: "ada@example.com",
          avatarUrl: "https://example.com/ada.webp",
        },
        ticket: {
          orderId,
          orderNumber: order.orderNumber,
          ticketType: "General Admission",
          quantity: 1,
          paymentStatus: "paid",
        },
      });
      assert.equal(JSON.stringify(payload.data).includes(qrToken), false);
    } finally {
      updateTicket.mock.restore();
      findTicket.mock.restore();
      findEvent.mock.restore();
    }
  }
});

test("QR preview hides attendee data for invalid and wrong-event tickets", async () => {
  const now = Date.now();
  const previewRequest = { ...request, params: { eventId } } as unknown as Request;
  const findEvent = mock.method(EventModel, "findOne", async () => ({
    _id: eventId,
    title: "Community Meetup",
    startsAt: new Date(now),
    endsAt: new Date(now + 60 * minute),
  }));
  const findTicket = mock.method(TicketOrderModel, "findOne", () => {
    const query = {
      select: () => query,
      populate: () => query,
      lean: async () => null,
    };
    return query;
  });

  try {
    for (const token of [qrToken, "another-event-ticket-token-1234567890"]) {
      const submittedRequest = { ...previewRequest, body: { qrToken: token } } as Request;
      const { response, getBody } = createResponse();
      await assert.rejects(verifyCheckInTicket(submittedRequest, response), (error: unknown) => {
        const failure = error as { statusCode?: number; code?: string; message?: string };
        assert.equal(failure.statusCode, 404);
        assert.equal(failure.code, "INVALID_TICKET");
        assert.equal(failure.message, "Ticket is invalid");
        return true;
      });
      assert.equal(getBody(), undefined);
    }
    for (const call of findTicket.mock.calls) {
      const filter = call.arguments[0] as { eventId?: string; status?: string } | undefined;
      assert.equal(filter?.eventId, eventId);
      assert.equal(filter?.status, "paid");
    }
  } finally {
    findTicket.mock.restore();
    findEvent.mock.restore();
  }
});

test("final check-in rejects a ticket used after a successful preview", async () => {
  const now = Date.now();
  const priorCheckIn = new Date(now - minute);
  const event = {
    _id: eventId,
    title: "Community Meetup",
    startsAt: new Date(now - 30 * minute),
    endsAt: new Date(now + 60 * minute),
  };
  let ticketUsed = false;
  const findEvent = mock.method(EventModel, "findOne", async () => event);
  const findTicket = mock.method(TicketOrderModel, "findOne", () => {
    const query = {
      select: () => query,
      populate: () => query,
      lean: async () => ticketUsed
        ? { checkedInAt: priorCheckIn }
        : {
          _id: "507f1f77bcf86cd799439014",
          orderNumber: "CC-1784370000000-A1B2C3D4",
          quantity: 1,
          status: "paid",
          buyerId: { _id: "507f1f77bcf86cd799439013", firstName: "Ada", lastName: "Okafor", email: "ada@example.com" },
          ticketTypeId: { title: "General Admission" },
        },
    };
    return query;
  });
  const updateTicket = mock.method(TicketOrderModel, "findOneAndUpdate", () => ({
    select: async () => null,
  }));

  try {
    const { response, getBody } = createResponse();
    await verifyCheckInTicket({ ...request, params: { eventId } } as unknown as Request, response);
    assert.equal((getBody() as { data: { canCheckIn: boolean } }).data.canCheckIn, true);

    ticketUsed = true;
    await assert.rejects(checkInTicket(request, createResponse().response), (error: unknown) => {
      const failure = error as { statusCode?: number; code?: string };
      assert.equal(failure.statusCode, 409);
      assert.equal(failure.code, "TICKET_ALREADY_USED");
      return true;
    });
    assert.equal(updateTicket.mock.callCount(), 1);
    const filter = updateTicket.mock.calls[0]?.arguments[0] as { checkedInAt?: { $exists: boolean } } | undefined;
    assert.deepEqual(filter?.checkedInAt, { $exists: false });
  } finally {
    updateTicket.mock.restore();
    findTicket.mock.restore();
    findEvent.mock.restore();
  }
});
