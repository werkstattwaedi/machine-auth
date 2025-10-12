/**
 * Admin API endpoints for the web admin interface
 *
 * Uses Firebase Auth for authentication (admin role required)
 */

import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import Particle from "particle-api-js";

const particleToken = defineSecret("PARTICLE_TOKEN");
const particleProductId = defineString("PARTICLE_PRODUCT_ID");

export const adminApp = express();
adminApp.use(express.json());

/**
 * Authentication middleware - verify Firebase Auth token and admin role
 */
const adminAuthMiddleware = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Admin API: Missing or invalid Authorization header.");
    res.status(401).send({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify Firebase Auth token
    const decodedToken = await getAuth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // Get user document to check role
    const db = getFirestore();
    const usersSnapshot = await db
      .collection("users")
      .where("firebaseUid", "==", uid)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      logger.warn(`Admin API: User not found for uid: ${uid}`);
      res.status(403).send({ error: "User not found" });
      return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();

    // Check if user has admin role
    if (!userData.roles || !userData.roles.includes("admin")) {
      logger.warn(`Admin API: User ${uid} is not an admin`);
      res.status(403).send({ error: "Admin access required" });
      return;
    }

    // Attach user info to request
    (req as any).user = {
      uid,
      userId: userDoc.id,
      ...userData,
    };

    next();
  } catch (error) {
    logger.error("Admin API: Auth error", error);
    res.status(401).send({ error: "Invalid token" });
  }
};

adminApp.use(adminAuthMiddleware);

/**
 * List devices from Particle Cloud
 * GET /particle/devices
 */
adminApp.get("/particle/devices", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const particle = new Particle();
    const productId = particleProductId.value();
    const token = particleToken.value();

    if (!productId || !token) {
      res.status(500).send({
        error: "Particle configuration missing. Contact administrator.",
      });
      return;
    }

    logger.info(`Listing devices for product: ${productId}`);

    // List devices in the product
    const response = await particle.listDevices({
      product: productId,
      auth: token,
    });

    // Response structure: { devices: [...], customers: [...], meta: {...} }
    const deviceList = response.body.devices || [];

    const devices = deviceList.map((device: any) => ({
      id: device.id,
      name: device.name,
      online: device.online,
      lastHeard: device.last_heard,
      platform: device.platform_id,
      productId: device.product_id,
      variables: device.variables,
      functions: device.functions,
    }));

    logger.info(`Found ${devices.length} devices`);

    res.status(200).json({ devices });
  } catch (error: any) {
    logger.error("Error listing Particle devices:", error);
    res.status(500).json({
      error: "Failed to list devices",
      details: error.message,
    });
  }
});

/**
 * Import a device as a terminal (MaCo)
 * POST /particle/import-device
 * Body: { deviceId: string, name?: string }
 */
adminApp.post("/particle/import-device", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { deviceId, name } = req.body;

    if (!deviceId) {
      res.status(400).json({ error: "deviceId is required" });
      return;
    }

    const particle = new Particle();
    const productId = particleProductId.value();
    const token = particleToken.value();

    // Get device info from Particle
    const deviceResponse = await particle.getDevice({
      deviceId,
      product: productId,
      auth: token,
    });

    const device = deviceResponse.body;

    // Use provided name or fallback to Particle device name
    const terminalName = name || device.name || deviceId;

    // Create terminal in Firestore
    const db = getFirestore();
    const macoRef = db.collection("maco").doc(deviceId);

    // Check if already exists
    const existingDoc = await macoRef.get();
    if (existingDoc.exists) {
      res.status(409).json({
        error: "Terminal already exists",
        deviceId,
      });
      return;
    }

    // Create terminal document
    await macoRef.set({
      name: terminalName,
      hwRevision: 0, // Default to Prototype
    });

    logger.info(`Imported device ${deviceId} as terminal: ${terminalName}`);

    res.status(201).json({
      success: true,
      deviceId,
      name: terminalName,
    });
  } catch (error: any) {
    logger.error("Error importing device:", error);
    res.status(500).json({
      error: "Failed to import device",
      details: error.message,
    });
  }
});

export const admin = onRequest(
  { secrets: [particleToken], cors: true },
  adminApp
);
