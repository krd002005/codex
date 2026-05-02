import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type OfferStatus = "pending" | "accepted" | "rejected" | "canceled" | "expired";

interface AcceptOfferRequest {
  offerId: string;
}

export const acceptSwapOffer = functions.https.onCall(async (data: AcceptOfferRequest, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ログインが必要です。");
  }

  const uid = context.auth.uid;
  const offerId = data?.offerId;
  if (!offerId || typeof offerId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "offerId は必須です。");
  }

  const offerRef = db.collection("swap_offers").doc(offerId);

  const result = await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists) {
      throw new functions.https.HttpsError("not-found", "交換提案が存在しません。");
    }

    const offer = offerSnap.data() as {
      proposer_uid: string;
      receiver_uid: string;
      proposer_item_id: string;
      receiver_item_id: string;
      status: OfferStatus;
      expires_at?: admin.firestore.Timestamp;
    };

    if (offer.receiver_uid !== uid) {
      throw new functions.https.HttpsError("permission-denied", "受信者のみ承認できます。");
    }

    if (offer.status !== "pending") {
      throw new functions.https.HttpsError("failed-precondition", "pending の提案のみ承認できます。");
    }

    if (offer.expires_at && offer.expires_at.toMillis() < Date.now()) {
      tx.update(offerRef, {
        status: "expired",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new functions.https.HttpsError("deadline-exceeded", "提案の有効期限が切れています。");
    }

    const proposerItemRef = db.collection("items").doc(offer.proposer_item_id);
    const receiverItemRef = db.collection("items").doc(offer.receiver_item_id);

    const [proposerItemSnap, receiverItemSnap] = await Promise.all([
      tx.get(proposerItemRef),
      tx.get(receiverItemRef),
    ]);

    if (!proposerItemSnap.exists || !receiverItemSnap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "交換対象アイテムが見つかりません。");
    }

    const proposerItem = proposerItemSnap.data() as { owner_uid: string; status: string };
    const receiverItem = receiverItemSnap.data() as { owner_uid: string; status: string };

    if (proposerItem.owner_uid !== offer.proposer_uid || receiverItem.owner_uid !== offer.receiver_uid) {
      throw new functions.https.HttpsError("failed-precondition", "アイテム所有者が不一致です。");
    }

    if (proposerItem.status !== "active" || receiverItem.status !== "active") {
      throw new functions.https.HttpsError("failed-precondition", "active なアイテムのみ交換できます。");
    }

    const chatRef = db.collection("chats").doc();
    const txRef = db.collection("transactions").doc(`tx_${offerId}`);

    tx.update(offerRef, {
      status: "accepted",
      accepted_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(chatRef, {
      transaction_id: txRef.id,
      member_uids: [offer.proposer_uid, offer.receiver_uid],
      last_message: "",
      last_message_at: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(txRef, {
      offer_id: offerId,
      chat_id: chatRef.id,
      user_a_uid: offer.proposer_uid,
      user_b_uid: offer.receiver_uid,
      item_a_id: offer.proposer_item_id,
      item_b_id: offer.receiver_item_id,
      status: "approved",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(proposerItemRef, {
      status: "in_offer",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(receiverItemRef, {
      status: "in_offer",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { transactionId: txRef.id, chatId: chatRef.id };
  });

  return {
    ok: true,
    offerId,
    ...result,
  };
});
