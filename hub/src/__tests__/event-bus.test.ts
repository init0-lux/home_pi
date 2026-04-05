import { eventBus, EventTypes } from "../core/event-bus.js";

// ─── Event Bus Tests ──────────────────────────────────────────────────────────

describe("EventBus", () => {
  afterEach(() => {
    // Clean up all listeners between tests
    Object.values(EventTypes).forEach((type) => {
      eventBus.off(type);
    });
  });

  // ── Basic pub/sub ───────────────────────────────────────────────────────────

  describe("on / emit", () => {
    it("should call a registered listener when an event is emitted", (done) => {
      eventBus.on(EventTypes.DEVICE_ONLINE, (payload) => {
        expect(payload.deviceId).toBe("device-001");
        expect(typeof payload.timestamp).toBe("number");
        done();
      });

      eventBus.emit(EventTypes.DEVICE_ONLINE, {
        deviceId: "device-001",
        timestamp: Date.now(),
      });
    });

    it("should call multiple listeners for the same event", () => {
      const calls: string[] = [];

      eventBus.on(EventTypes.DEVICE_ONLINE, () => {
        calls.push("listener-1");
      });
      eventBus.on(EventTypes.DEVICE_ONLINE, () => {
        calls.push("listener-2");
      });
      eventBus.on(EventTypes.DEVICE_ONLINE, () => {
        calls.push("listener-3");
      });

      eventBus.emit(EventTypes.DEVICE_ONLINE, {
        deviceId: "device-002",
        timestamp: Date.now(),
      });

      expect(calls).toEqual(["listener-1", "listener-2", "listener-3"]);
    });

    it("should pass the correct payload to listeners", (done) => {
      const expectedPayload = {
        deviceId: "relay-42",
        channel: 2,
        state: "ON" as const,
        source: "api" as const,
        timestamp: 1712000000000,
      };

      eventBus.on(EventTypes.DEVICE_STATE_CHANGED, (payload) => {
        expect(payload).toMatchObject(expectedPayload);
        done();
      });

      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, expectedPayload);
    });

    it("should not call listeners for a different event type", () => {
      const onlineSpy = jest.fn();
      const offlineSpy = jest.fn();

      eventBus.on(EventTypes.DEVICE_ONLINE, onlineSpy);
      eventBus.on(EventTypes.DEVICE_OFFLINE, offlineSpy);

      eventBus.emit(EventTypes.DEVICE_ONLINE, {
        deviceId: "device-003",
        timestamp: Date.now(),
      });

      expect(onlineSpy).toHaveBeenCalledTimes(1);
      expect(offlineSpy).not.toHaveBeenCalled();
    });
  });

  // ── once ────────────────────────────────────────────────────────────────────

  describe("once", () => {
    it("should call a once listener only on the first emit", (done) => {
      let callCount = 0;

      eventBus.once(EventTypes.MQTT_CONNECTED, () => {
        callCount++;
        // Schedule the assertion after all potential emissions
        setImmediate(() => {
          expect(callCount).toBe(1);
          done();
        });
      });

      eventBus.emit(EventTypes.MQTT_CONNECTED, {
        brokerUrl: "mqtt://localhost:1883",
        timestamp: Date.now(),
      });
      // These should NOT trigger the once listener again
      eventBus.emit(EventTypes.MQTT_CONNECTED, {
        brokerUrl: "mqtt://localhost:1883",
        timestamp: Date.now(),
      });
      eventBus.emit(EventTypes.MQTT_CONNECTED, {
        brokerUrl: "mqtt://localhost:1883",
        timestamp: Date.now(),
      });
    });
  });

  // ── off (unsubscribe) ────────────────────────────────────────────────────────

  describe("off", () => {
    it("should remove all listeners for an event type", () => {
      const spy = jest.fn<void, []>();

      eventBus.on(EventTypes.DEVICE_REGISTERED, spy);
      eventBus.on(EventTypes.DEVICE_REGISTERED, spy);

      eventBus.off(EventTypes.DEVICE_REGISTERED);

      eventBus.emit(EventTypes.DEVICE_REGISTERED, {
        deviceId: "device-new",
        type: "relay",
        timestamp: Date.now(),
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("should return an unsubscribe function that removes only that handler", () => {
      const spy1 = jest.fn<void, []>();
      const spy2 = jest.fn<void, []>();

      const unsub1 = eventBus.on(EventTypes.DEVICE_ONLINE, spy1);
      eventBus.on(EventTypes.DEVICE_ONLINE, spy2);

      // Unsubscribe only spy1
      unsub1();

      eventBus.emit(EventTypes.DEVICE_ONLINE, {
        deviceId: "device-004",
        timestamp: Date.now(),
      });

      expect(spy1).not.toHaveBeenCalled();
      expect(spy2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Idempotency ──────────────────────────────────────────────────────────────

  describe("idempotency (duplicate event deduplication)", () => {
    it("should drop duplicate DEVICE_STATE_CHANGED events in the same second", () => {
      const spy = jest.fn<void, []>();
      eventBus.on(EventTypes.DEVICE_STATE_CHANGED, spy);

      const baseTimestamp = 1712000000000; // ms

      // First event — should fire
      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, {
        deviceId: "device-dup",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: baseTimestamp,
      });

      // Same device, same 1-second bucket — should be dropped
      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, {
        deviceId: "device-dup",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: baseTimestamp + 500, // still within the same second
      });

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("should allow the same event after 1 second has passed (different bucket)", () => {
      const spy = jest.fn<void, []>();
      eventBus.on(EventTypes.DEVICE_STATE_CHANGED, spy);

      // First second
      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, {
        deviceId: "device-bucket",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: 1712000000000,
      });

      // Next second (different 1s bucket)
      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, {
        deviceId: "device-bucket",
        channel: 0,
        state: "OFF",
        source: "mqtt",
        timestamp: 1712000001000, // +1s
      });

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("should NOT deduplicate events for different device IDs", () => {
      const spy = jest.fn<void, []>();
      eventBus.on(EventTypes.DEVICE_STATE_CHANGED, spy);

      const ts = 1712000000000;

      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, {
        deviceId: "device-A",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: ts,
      });

      eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, {
        deviceId: "device-B",
        channel: 0,
        state: "ON",
        source: "mqtt",
        timestamp: ts,
      });

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("should NOT deduplicate non-state events (e.g. SYSTEM_READY)", () => {
      const spy = jest.fn<void, []>();
      eventBus.on(EventTypes.SYSTEM_READY, spy);

      eventBus.emit(EventTypes.SYSTEM_READY, { timestamp: Date.now() });
      eventBus.emit(EventTypes.SYSTEM_READY, { timestamp: Date.now() });
      eventBus.emit(EventTypes.SYSTEM_READY, { timestamp: Date.now() });

      // SYSTEM_READY has no idempotency key — all three should fire
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  describe("error isolation", () => {
    it("should not let an error in one listener crash other listeners", () => {
      const errorSpy = jest.fn<void, []>().mockImplementation(() => {
        throw new Error("boom");
      });
      const safeSpy = jest.fn<void, []>();

      eventBus.on(EventTypes.DEVICE_OFFLINE, errorSpy);
      eventBus.on(EventTypes.DEVICE_OFFLINE, safeSpy);

      // Should not throw
      expect(() => {
        eventBus.emit(EventTypes.DEVICE_OFFLINE, {
          deviceId: "device-error",
          lastSeen: 0,
          timestamp: Date.now(),
        });
      }).not.toThrow();

      // Both handlers were invoked (error is caught internally per handler)
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          expect(errorSpy).toHaveBeenCalledTimes(1);
          expect(safeSpy).toHaveBeenCalledTimes(1);
          resolve();
        });
      });
    });
  });

  // ── listenerCount ────────────────────────────────────────────────────────────

  describe("listenerCount", () => {
    it("should return 0 when no listeners are registered", () => {
      expect(eventBus.listenerCount(EventTypes.GUEST_CHECKIN)).toBe(0);
    });

    it("should return the correct number of listeners", () => {
      eventBus.on(EventTypes.GUEST_CHECKIN, jest.fn<void, []>());
      eventBus.on(EventTypes.GUEST_CHECKIN, jest.fn<void, []>());
      eventBus.on(EventTypes.GUEST_CHECKIN, jest.fn<void, []>());

      expect(eventBus.listenerCount(EventTypes.GUEST_CHECKIN)).toBe(3);
    });

    it("should return 0 after all listeners are removed via off()", () => {
      eventBus.on(EventTypes.GUEST_CHECKIN, jest.fn<void, []>());
      eventBus.on(EventTypes.GUEST_CHECKIN, jest.fn<void, []>());

      eventBus.off(EventTypes.GUEST_CHECKIN);

      expect(eventBus.listenerCount(EventTypes.GUEST_CHECKIN)).toBe(0);
    });
  });

  // ── Guest lifecycle events ────────────────────────────────────────────────────

  describe("guest lifecycle events", () => {
    it("should emit GUEST_CHECKIN with the correct payload", (done) => {
      eventBus.on(EventTypes.GUEST_CHECKIN, (payload) => {
        expect(payload.guestId).toBe("G-999");
        expect(payload.roomId).toBe("room-uuid-abc");
        expect(payload.checkinTime).toBe(1712000000);
        done();
      });

      eventBus.emit(EventTypes.GUEST_CHECKIN, {
        guestId: "G-999",
        roomId: "room-uuid-abc",
        checkinTime: 1712000000,
        timestamp: Date.now(),
      });
    });

    it("should emit GUEST_CHECKOUT with the correct payload", (done) => {
      eventBus.on(EventTypes.GUEST_CHECKOUT, (payload) => {
        expect(payload.guestId).toBe("G-999");
        expect(payload.roomId).toBe("room-uuid-abc");
        expect(typeof payload.checkoutTime).toBe("number");
        done();
      });

      eventBus.emit(EventTypes.GUEST_CHECKOUT, {
        guestId: "G-999",
        roomId: "room-uuid-abc",
        checkoutTime: 1712086400,
        timestamp: Date.now(),
      });
    });
  });

  // ── Automation lifecycle events ───────────────────────────────────────────────

  describe("automation events", () => {
    it("should emit AUTOMATION_TRIGGERED with the correct payload", (done) => {
      eventBus.on(EventTypes.AUTOMATION_TRIGGERED, (payload) => {
        expect(payload.automationId).toBe("auto-001");
        expect(Array.isArray(payload.actions)).toBe(true);
        expect(payload.actions).toHaveLength(1);
        done();
      });

      eventBus.emit(EventTypes.AUTOMATION_TRIGGERED, {
        automationId: "auto-001",
        trigger: { type: "guest_checkin", roomId: "room-xyz" },
        actions: [{ type: "set_room_state", roomId: "room-xyz", state: "ON" }],
        timestamp: Date.now(),
      });
    });

    it("should emit SCHEDULE_FIRED with the correct payload", (done) => {
      eventBus.on(EventTypes.SCHEDULE_FIRED, (payload) => {
        expect(payload.scheduleId).toBe("sched-001");
        expect(payload.deviceId).toBe("device-abc");
        expect(payload.action).toMatchObject({ state: "OFF" });
        done();
      });

      eventBus.emit(EventTypes.SCHEDULE_FIRED, {
        scheduleId: "sched-001",
        deviceId: "device-abc",
        action: { state: "OFF", channel: 0 },
        timestamp: Date.now(),
      });
    });
  });

  // ── MQTT lifecycle events ─────────────────────────────────────────────────────

  describe("MQTT lifecycle events", () => {
    it("should emit MQTT_CONNECTED with broker URL", (done) => {
      eventBus.on(EventTypes.MQTT_CONNECTED, (payload) => {
        expect(payload.brokerUrl).toBe("mqtt://localhost:1883");
        done();
      });

      eventBus.emit(EventTypes.MQTT_CONNECTED, {
        brokerUrl: "mqtt://localhost:1883",
        timestamp: Date.now(),
      });
    });

    it("should emit MQTT_DISCONNECTED with optional reason", (done) => {
      eventBus.on(EventTypes.MQTT_DISCONNECTED, (payload) => {
        expect(payload.reason).toBe("broker disconnected");
        done();
      });

      eventBus.emit(EventTypes.MQTT_DISCONNECTED, {
        reason: "broker disconnected",
        timestamp: Date.now(),
      });
    });

    it("should emit MQTT_MESSAGE with topic and message", (done) => {
      eventBus.on(EventTypes.MQTT_MESSAGE, (payload) => {
        expect(payload.topic).toBe("home/room101/relay-1/state");
        expect(payload.message).toBe('{"state":"ON","channel":0}');
        done();
      });

      eventBus.emit(EventTypes.MQTT_MESSAGE, {
        topic: "home/room101/relay-1/state",
        message: '{"state":"ON","channel":0}',
        timestamp: Date.now(),
      });
    });
  });

  // ── System lifecycle events ───────────────────────────────────────────────────

  describe("system lifecycle events", () => {
    it("should emit SYSTEM_READY with timestamp", (done) => {
      const before = Date.now();

      eventBus.on(EventTypes.SYSTEM_READY, (payload) => {
        expect(payload.timestamp).toBeGreaterThanOrEqual(before);
        done();
      });

      eventBus.emit(EventTypes.SYSTEM_READY, { timestamp: Date.now() });
    });

    it("should emit SYSTEM_SHUTDOWN with optional reason", (done) => {
      eventBus.on(EventTypes.SYSTEM_SHUTDOWN, (payload) => {
        expect(payload.reason).toBe("Signal: SIGTERM");
        done();
      });

      eventBus.emit(EventTypes.SYSTEM_SHUTDOWN, {
        reason: "Signal: SIGTERM",
        timestamp: Date.now(),
      });
    });
  });

  // ── Heartbeat deduplication ────────────────────────────────────────────────

  describe("heartbeat idempotency", () => {
    it("should deduplicate DEVICE_HEARTBEAT events in the same second", () => {
      const spy = jest.fn<void, []>();
      eventBus.on(EventTypes.DEVICE_HEARTBEAT, spy);

      const ts = 1712000005000;

      eventBus.emit(EventTypes.DEVICE_HEARTBEAT, {
        deviceId: "esp-001",
        timestamp: ts,
      });

      eventBus.emit(EventTypes.DEVICE_HEARTBEAT, {
        deviceId: "esp-001",
        timestamp: ts + 200,
      });

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("should allow heartbeats from the same device in different seconds", () => {
      const spy = jest.fn<void, []>();
      eventBus.on(EventTypes.DEVICE_HEARTBEAT, spy);

      eventBus.emit(EventTypes.DEVICE_HEARTBEAT, {
        deviceId: "esp-002",
        timestamp: 1712000010000,
      });

      eventBus.emit(EventTypes.DEVICE_HEARTBEAT, {
        deviceId: "esp-002",
        timestamp: 1712000011000, // next second
      });

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
