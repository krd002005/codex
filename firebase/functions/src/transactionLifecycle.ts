import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type TxStatus = "approved" | "preparing" | "shipped" | "received" | "completed" | "canceled";

interface TxRequest {
  txId: string;
}

interface ShippingRequest extends TxRequest {
  carrier?: string;
  trackingNo?: string;
}

function assertParticipant(txData: any, uid: string) {
  if (txData.user_a_uid !== uid && txData.user_b_uid !== uid) {
    throw new functions.https.HttpsError("permission-denied", "当事者のみ実行できます。");
  }
}

export const markPreparing = functions.https.onCall(async (data: TxRequest, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
  const uid = context.auth.uid;
  const txId = data?.txId;
  if (!txId) throw new functions.https.HttpsError("invalid-argument", "txId は必須です。");

  const txRef = db.collection("transactions").doc(txId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(txRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "取引が存在しません。");
    const row = snap.data() as any;
    assertParticipant(row, uid);
    if (row.status !== "approved") {
      throw new functions.https.HttpsError("failed-precondition", "approved のみ preparing に更新できます。");
    }
    tx.update(txRef, {
      status: "preparing" as TxStatus,
      ship_by_at: admin.firestore.Timestamp.fromMillis(Date.now() + 3 * 24 * 60 * 60 * 1000),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, txId, status: "preparing" };
});

export const markShipped = functions.https.onCall(async (data: ShippingRequest, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
  const uid = context.auth.uid;
  const txId = data?.txId;
  if (!txId) throw new functions.https.HttpsError("invalid-argument", "txId は必須です。");

  const txRef = db.collection("transactions").doc(txId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(txRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "取引が存在しません。");
    const row = snap.data() as any;
    assertParticipant(row, uid);
    if (row.status !== "preparing" && row.status !== "shipped") {
      throw new functions.https.HttpsError("failed-precondition", "preparing/shipped のみ発送更新できます。");
    }

    const payload: Record<string, unknown> = {
      status: "shipped" as TxStatus,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (uid === row.user_a_uid && !row.shipped_a_at) {
      payload.shipped_a_at = admin.firestore.FieldValue.serverTimestamp();
      if (data?.carrier) payload.ship_carrier_a = data.carrier;
      if (data?.trackingNo) payload.tracking_no_a = data.trackingNo;
    }
    if (uid === row.user_b_uid && !row.shipped_b_at) {
      payload.shipped_b_at = admin.firestore.FieldValue.serverTimestamp();
      if (data?.carrier) payload.ship_carrier_b = data.carrier;
      if (data?.trackingNo) payload.tracking_no_b = data.trackingNo;
    }

    tx.update(txRef, payload);
  });

  return { ok: true, txId, status: "shipped" };
});

export const markReceived = functions.https.onCall(async (data: TxRequest, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
  const uid = context.auth.uid;
  const txId = data?.txId;
  if (!txId) throw new functions.https.HttpsError("invalid-argument", "txId は必須です。");

  const txRef = db.collection("transactions").doc(txId);
  const itemUpdates = await db.runTransaction(async (tx) => {
    const snap = await tx.get(txRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "取引が存在しません。");
    const row = snap.data() as any;
    assertParticipant(row, uid);
    if (row.status !== "shipped" && row.status !== "received") {
      throw new functions.https.HttpsError("failed-precondition", "shipped/received のみ受取確認できます。");
    }

    const payload: Record<string, unknown> = {
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (uid === row.user_a_uid && !row.received_a_at) payload.received_a_at = admin.firestore.FieldValue.serverTimestamp();
    if (uid === row.user_b_uid && !row.received_b_at) payload.received_b_at = admin.firestore.FieldValue.serverTimestamp();

    const willComplete = Boolean(
      (uid === row.user_a_uid ? payload.received_a_at : row.received_a_at) &&
      (uid === row.user_b_uid ? payload.received_b_at : row.received_b_at)
    );

    payload.status = willComplete ? ("completed" as TxStatus) : ("received" as TxStatus);
    if (willComplete) payload.completed_at = admin.firestore.FieldValue.serverTimestamp();

    tx.update(txRef, payload);

    return willComplete ? { itemA: row.item_a_id as string, itemB: row.item_b_id as string } : null;
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
