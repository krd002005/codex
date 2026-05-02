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
exports.cancelSwapOffer = exports.rejectSwapOffer = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.rejectSwapOffer = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
    const uid = context.auth.uid;
    const offerId = data?.offerId;
    if (!offerId || typeof offerId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "offerId は必須です。");
    }
    const offerRef = db.collection("swap_offers").doc(offerId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(offerRef);
        if (!snap.exists)
            throw new functions.https.HttpsError("not-found", "交換提案が存在しません。");
        const offer = snap.data();
        if (offer.receiver_uid !== uid) {
            throw new functions.https.HttpsError("permission-denied", "受信者のみ拒否できます。");
        }
        if (offer.status !== "pending") {
            throw new functions.https.HttpsError("failed-precondition", "pending の提案のみ拒否できます。");
        }
        tx.update(offerRef, {
            status: "rejected",
            rejected_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true, offerId, status: "rejected" };
});
exports.cancelSwapOffer = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
    const uid = context.auth.uid;
    const offerId = data?.offerId;
    if (!offerId || typeof offerId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "offerId は必須です。");
    }
    const offerRef = db.collection("swap_offers").doc(offerId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(offerRef);
        if (!snap.exists)
            throw new functions.https.HttpsError("not-found", "交換提案が存在しません。");
        const offer = snap.data();
        if (offer.proposer_uid !== uid) {
            throw new functions.https.HttpsError("permission-denied", "送信者のみ取消できます。");
        }
        if (offer.status !== "pending") {
            throw new functions.https.HttpsError("failed-precondition", "pending の提案のみ取消できます。");
        }
        tx.update(offerRef, {
            status: "canceled",
            canceled_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true, offerId, status: "canceled" };
});
//# sourceMappingURL=rejectCancelOffer.js.map