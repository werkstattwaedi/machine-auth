#!/usr/bin/env node
/**
 * Script to add a new token to the Firestore database
 * Usage: node add_token.mjs <tokenId> <userId> [label]
 */

import admin from "firebase-admin";

async function addToken() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: node add_token.mjs <tokenId> <userId> [label]");
    console.error("");
    console.error("Examples:");
    console.error("  node add_token.mjs 04c439aa1e1890 QUYoZPOVyVPmf007Vfv8");
    console.error("  node add_token.mjs 04c439aa1e1890 QUYoZPOVyVPmf007Vfv8 'My NFC Card'");
    console.error("");
    console.error("To list existing users, run:");
    console.error("  node list_users.mjs");
    process.exit(1);
  }

  const tokenId = args[0].toLowerCase(); // Normalize to lowercase
  const userId = args[1];
  const label = args[2] || `Token ${tokenId.substring(0, 8)}`;

  // Initialize Firebase Admin
  admin.initializeApp();
  const db = admin.firestore();

  console.log("Adding token to database...");
  console.log(`  Token ID: ${tokenId}`);
  console.log(`  User ID: ${userId}`);
  console.log(`  Label: ${label}`);
  console.log("");

  try {
    // Check if user exists
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.error(`❌ Error: User ${userId} does not exist`);
      console.error("");
      console.error("Available users:");
      const usersSnapshot = await db.collection("users").get();
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        console.error(`  - ${doc.id} (${data.displayName || data.name || 'No name'})`);
      });
      process.exit(1);
    }

    const userData = userDoc.data();
    console.log(`✓ Found user: ${userData.displayName || userData.name || userId}`);

    // Check if token already exists
    const existingToken = await db.collection("tokens").doc(tokenId).get();
    if (existingToken.exists) {
      console.error(`❌ Error: Token ${tokenId} already exists`);
      const tokenData = existingToken.data();
      console.error(`   Currently assigned to: ${tokenData.userId}`);
      console.error(`   Label: ${tokenData.label}`);
      process.exit(1);
    }

    // Create the token
    const tokenData = {
      userId: `/users/${userId}`,
      registered: admin.firestore.Timestamp.now(),
      deactivated: null,
      label: label
    };

    await db.collection("tokens").doc(tokenId).set(tokenData);

    console.log("");
    console.log("✅ Token added successfully!");
    console.log(`   Path: tokens/${tokenId}`);
    console.log(`   User: ${userData.displayName || userData.name || userId}`);
    console.log(`   Label: ${label}`);

  } catch (error) {
    console.error("❌ Failed to add token:", error.message);
    process.exit(1);
  }

  process.exit(0);
}

addToken();
