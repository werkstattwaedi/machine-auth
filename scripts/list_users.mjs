#!/usr/bin/env node
/**
 * Script to list all users in the database
 */

import admin from "firebase-admin";

async function listUsers() {
  // Initialize Firebase Admin
  admin.initializeApp();
  const db = admin.firestore();

  console.log("Fetching users...\n");

  try {
    const usersSnapshot = await db.collection("users").get();

    if (usersSnapshot.empty) {
      console.log("No users found in database.");
      process.exit(0);
    }

    console.log(`Found ${usersSnapshot.size} user(s):\n`);

    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      console.log(`📋 User ID: ${doc.id}`);
      console.log(`   Name: ${data.name || 'N/A'}`);
      console.log(`   Display Name: ${data.displayName || 'N/A'}`);
      console.log(`   Permissions: ${data.permissions?.join(', ') || 'None'}`);
      console.log(`   Roles: ${data.roles?.join(', ') || 'None'}`);

      // Count tokens for this user
      const tokensSnapshot = await db
        .collection("tokens")
        .where("userId", "==", `/users/${doc.id}`)
        .get();
      console.log(`   Tokens: ${tokensSnapshot.size}`);

      tokensSnapshot.forEach(tokenDoc => {
        const tokenData = tokenDoc.data();
        console.log(`     - ${tokenDoc.id} (${tokenData.label || 'No label'})`);
      });

      console.log("");
    }

  } catch (error) {
    console.error("❌ Failed to list users:", error.message);
    process.exit(1);
  }

  process.exit(0);
}

listUsers();
