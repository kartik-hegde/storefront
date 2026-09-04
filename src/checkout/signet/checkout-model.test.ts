import { describe, expect, it } from "vitest";

import { purchaseRequestMarker, readPurchaseRequestId, removePurchaseRequestMarkers } from "./checkout-model";

describe("Signett purchase request markers", () => {
	it("reads the latest persisted request ID", () => {
		const note = [purchaseRequestMarker("request-1"), purchaseRequestMarker("request-2")].join("\n\n");

		expect(readPurchaseRequestId(note)).toBe("request-2");
	});

	it("preserves merchant notes when resetting the demo", () => {
		const note = ["Leave at reception", purchaseRequestMarker("request-1")].join("\n\n");

		expect(removePurchaseRequestMarkers(note)).toBe("Leave at reception");
		expect(readPurchaseRequestId(removePurchaseRequestMarkers(note))).toBeNull();
	});
});
