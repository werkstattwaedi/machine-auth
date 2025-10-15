/**
 * @fileoverview Seeds test sessions for checkout testing
 *
 * Creates test users, machines, tokens, and active sessions.
 * Run with: npm run seed-test-sessions
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Connect to Firebase emulator
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

// Initialize Firebase Admin
initializeApp({
  projectId: 'oww-maschinenfreigabe',
});
const db = getFirestore();

async function seedTestData() {
  console.log('🌱 Seeding test data for checkout...\n');

  try {
    // 1. Find or create test user
    console.log('Looking for existing user...');
    const usersSnapshot = await db.collection('users').limit(1).get();

    let userRef;
    if (!usersSnapshot.empty) {
      userRef = usersSnapshot.docs[0].ref;
      const userData = usersSnapshot.docs[0].data();
      console.log(`✓ Using existing user: ${userData.email || 'unknown'} (${userRef.id})\n`);
    } else {
      console.log('No users found, creating test user...');
      userRef = await db.collection('users').add({
        email: 'test@example.com',
        displayName: 'Test User',
        name: 'Test User',
        created: Timestamp.now(),
        roles: ['vereinsmitglied'],
        permissions: [],
      });
      console.log(`✓ User created: ${userRef.id}\n`);
    }

    // 2. Create test token
    console.log('Creating test token...');
    const tokenRef = db.collection('tokens').doc('04c339aa1e1890'); // Example UID
    await tokenRef.set({
      userId: userRef,
      registered: Timestamp.now(),
      label: 'Test Tag',
    });
    console.log('✓ Token created: 04c339aa1e1890\n');

    // 3. Create test machines
    console.log('Creating test machines...');

    const fraese = await db.collection('machine').add({
      name: 'Fräse',
      requiredPermission: [],
      control: {},
    });
    console.log(`✓ Machine created: ${fraese.id}`);

    const laser = await db.collection('machine').add({
      name: 'Laser',
      requiredPermission: [],
      control: {},
    });
    console.log(`✓ Machine created: ${laser.id}`);

    const saege = await db.collection('machine').add({
      name: 'Säge',
      requiredPermission: [],
      control: {},
    });
    console.log(`✓ Machine created: ${saege.id}\n`);

    // 4. Create test sessions with usage
    console.log('Creating test sessions...\n');

    // Session 1: Multiple machines, some checked out
    const now = Timestamp.now();
    const oneHourAgo = Timestamp.fromMillis(now.toMillis() - 60 * 60 * 1000);
    const twoHoursAgo = Timestamp.fromMillis(now.toMillis() - 2 * 60 * 60 * 1000);
    const thirtyMinsAgo = Timestamp.fromMillis(now.toMillis() - 30 * 60 * 1000);

    const session1Ref = await db.collection('sessions').add({
      userId: userRef,
      tokenId: tokenRef,
      startTime: twoHoursAgo,
      usage: [
        {
          machine: fraese,
          checkIn: twoHoursAgo,
          checkOut: oneHourAgo,
          metadata: JSON.stringify({ reason: 'user_checkout' }),
        },
        {
          machine: laser,
          checkIn: oneHourAgo,
          checkOut: thirtyMinsAgo,
          metadata: JSON.stringify({ reason: 'user_checkout' }),
        },
        {
          machine: saege,
          checkIn: thirtyMinsAgo,
          // Still checked in - no checkOut
        },
      ],
    });
    console.log(`✓ Session 1 created: ${session1Ref.id}`);
    console.log('  - Fräse: 60 min (checked out)');
    console.log('  - Laser: 30 min (checked out)');
    console.log('  - Säge: 30 min (still active)\n');

    // Session 2: Single machine, still active
    const fortyFiveMinsAgo = Timestamp.fromMillis(now.toMillis() - 45 * 60 * 1000);

    const session2Ref = await db.collection('sessions').add({
      userId: userRef,
      tokenId: tokenRef,
      startTime: fortyFiveMinsAgo,
      usage: [
        {
          machine: fraese,
          checkIn: fortyFiveMinsAgo,
          // Still checked in
        },
      ],
    });
    console.log(`✓ Session 2 created: ${session2Ref.id}`);
    console.log('  - Fräse: 45 min (still active)\n');

    // Summary
    const userData = (await userRef.get()).data();
    console.log('✅ Test data seeded successfully!\n');
    console.log('📊 Summary:');
    console.log(`  - User: ${userData?.email || 'unknown'} (${userRef.id})`);
    console.log('  - Token: 04c339aa1e1890');
    console.log('  - Machines:');
    console.log(`    - Fräse (${fraese.id})`);
    console.log(`    - Laser (${laser.id})`);
    console.log(`    - Säge (${saege.id})`);
    console.log('  - Active sessions: 2');
    console.log(`    - ${session1Ref.id}`);
    console.log(`    - ${session2Ref.id}`);
    console.log('  - Total usage time: ~2h 45min\n');
    console.log('🔗 Test checkout at:');
    console.log('   http://localhost:4200/checkout\n');

  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    process.exit(1);
  }

  process.exit(0);
}

seedTestData();
