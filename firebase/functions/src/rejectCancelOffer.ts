import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type OfferStatus = "pending" | "accepted" | "rejected" | "canceled" | "expired";

interface OfferActionRequest {
  offerId: string;
}

export const rejectSwapOffer = functions.https.onCall(async (data: OfferActionRequest, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
  const uid = context.auth.uid;
  const offerId = data?.offerId;
  if (!offerId || typeof offerId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "offerId は必須です。");
  }

  const offerRef = db.collection("swap_offers").doc(offerId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(offerRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "交換提案が存在しません。");

    const offer = snap.data() as { receiver_uid: string; status: OfferStatus };
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

export const cancelSwapOffer = functions.https.onCall(async (data: OfferActionRequest, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
  const uid = context.auth.uid;
  const offerId = data?.offerId;
  if (!offerId || typeof offerId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "offerId は必須です。");
  }

  const offerRef = db.collection("swap_offers").doc(offerId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(offerRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "交換提案が存在しません。");

    const offer = snap.data() as { proposer_uid: string; status: OfferStatus };
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
