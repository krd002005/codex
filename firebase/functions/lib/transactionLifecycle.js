"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.markReceived = exports.markShipped = exports.markPreparing = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
function assertParticipant(txData, uid) {
    if (txData.user_a_uid !== uid && txData.user_b_uid !== uid) {
        throw new functions.https.HttpsError("permission-denied", "当事者のみ実行できます。");
    }
}
exports.markPreparing = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
    const uid = context.auth.uid;
    const txId = data?.txId;
    if (!txId)
        throw new functions.https.HttpsError("invalid-argument", "txId は必須です。");
    const txRef = db.collection("transactions").doc(txId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists)
            throw new functions.https.HttpsError("not-found", "取引が存在しません。");
        const row = snap.data();
        assertParticipant(row, uid);
        if (row.status !== "approved") {
            throw new functions.https.HttpsError("failed-precondition", "approved のみ preparing に更新できます。");
        }
        tx.update(txRef, {
            status: "preparing",
            ship_by_at: admin.firestore.Timestamp.fromMillis(Date.now() + 3 * 24 * 60 * 60 * 1000),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true, txId, status: "preparing" };
});
exports.markShipped = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
    const uid = context.auth.uid;
    const txId = data?.txId;
    if (!txId)
        throw new functions.https.HttpsError("invalid-argument", "txId は必須です。");
    const txRef = db.collection("transactions").doc(txId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists)
            throw new functions.https.HttpsError("not-found", "取引が存在しません。");
        const row = snap.data();
        assertParticipant(row, uid);
        if (row.status !== "preparing" && row.status !== "shipped") {
            throw new functions.https.HttpsError("failed-precondition", "preparing/shipped のみ発送更新できます。");
        }
        const payload = {
            status: "shipped",
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (uid === row.user_a_uid && !row.shipped_a_at) {
            payload.shipped_a_at = admin.firestore.FieldValue.serverTimestamp();
            if (data?.carrier)
                payload.ship_carrier_a = data.carrier;
            if (data?.trackingNo)
                payload.tracking_no_a = data.trackingNo;
        }
        if (uid === row.user_b_uid && !row.shipped_b_at) {
            payload.shipped_b_at = admin.firestore.FieldValue.serverTimestamp();
            if (data?.carrier)
                payload.ship_carrier_b = data.carrier;
            if (data?.trackingNo)
                payload.tracking_no_b = data.trackingNo;
        }
        tx.update(txRef, payload);
    });
    return { ok: true, txId, status: "shipped" };
});
exports.markReceived = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
    const uid = context.auth.uid;
    const txId = data?.txId;
    if (!txId)
        throw new functions.https.HttpsError("invalid-argument", "txId は必須です。");
    const txRef = db.collection("transactions").doc(txId);
    const itemUpdates = await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists)
            throw new functions.https.HttpsError("not-found", "取引が存在しません。");
        const row = snap.data();
        assertParticipant(row, uid);
        if (row.status !== "shipped" && row.status !== "received") {
            throw new functions.https.HttpsError("failed-precondition", "shipped/received のみ受取確認できます。");
        }
        const payload = {
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (uid === row.user_a_uid && !row.received_a_at)
            payload.received_a_at = admin.firestore.FieldValue.serverTimestamp();
        if (uid === row.user_b_uid && !row.received_b_at)
            payload.received_b_at = admin.firestore.FieldValue.serverTimestamp();
        const willComplete = Boolean((uid === row.user_a_uid ? payload.received_a_at : row.received_a_at) &&
            (uid === row.user_b_uid ? payload.received_b_at : row.received_b_at));
        payload.status = willComplete ? "completed" : "received";
        if (willComplete)
            payload.completed_at = admin.firestore.FieldValue.serverTimestamp();
        tx.update(txRef, payload);
        return willComplete ? { itemA: row.item_a_id, itemB: row.item_b_id } : null;
    });
    if (itemUpdates) {
        const batch = db.batch();
        batch.update(db.collection("items").doc(itemUpdates.itemA), {
            status: "swapped",
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        batch.update(db.collection("items").doc(itemUpdates.itemB), {
            status: "swapped",
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
    }
    return { ok: true, txId };
});
//# sourceMappingURL=transactionLifecycle.js.map