/**
 * Admin API endpoints for the web admin interface
 *
 * Uses Firebase Auth for authentication (admin custom claim required).
 */

import express from "express";
import { rateLimit } from "express-rate-limit";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";

// Per-IP request budget. Read per request so tests can override via the
// `ADMIN_RATE_LIMIT` env var without re-importing the module. Production
// defaults to 60 req/min.
const adminRequestBudget = (
  _req: express.Request,
  _res: express.Response
): number => Number(process.env.ADMIN_RATE_LIMIT ?? 60);

export const adminApp = express();
adminApp.use(express.json());
// Firebase Functions sit behind exactly one Google Front End proxy, so trust
// the leftmost X-Forwarded-For hop for `req.ip`. Setting to `1` (rather than
// `true`) avoids the express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY
// warning about clients spoofing X-Forwarded-For.
adminApp.set("trust proxy", 1);

// Per-IP rate limit applied before auth so unauthenticated brute-force attempts
// are throttled too. The limiter is in-memory and therefore per-instance in
// serverless — best-effort rather than global, but it satisfies CodeQL's
// "missing rate limiting" check and is sufficient for an admin-only endpoint
// with a tiny user pool.
const adminRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: adminRequestBudget,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
adminApp.use(adminRateLimiter);

/**
 * Authentication middleware - verify Firebase Auth token and admin custom claim.
 *
 * Admin role lives on the auth token as a custom claim (`admin: true`), kept in
 * sync from `users/{uid}.roles` by the `syncCustomClaims` Firestore trigger.
 * Checking the claim here keeps the middleware consistent with `firestore.rules`
 * (`request.auth.token.admin`) and avoids an extra Firestore read per request.
 */
export const adminAuthMiddleware = async (
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

    if (decodedToken.admin !== true) {
      logger.warn(`Admin API: User ${uid} is not an admin`);
      res.status(403).send({ error: "Admin access required" });
      return;
    }

    // Attach user info to request
    (req as any).user = {
      uid,
      userId: uid,
    };

    next();
  } catch (error) {
    logger.error("Admin API: Auth error", error);
    res.status(401).send({ error: "Invalid token" });
  }
};

adminApp.use(adminAuthMiddleware);

// No routes today. The former Particle device import (/particle/*) was
// retired with the PARTICLE_TOKEN secret — terminal onboarding is manual
// `maco/{deviceId}` doc creation (see docs/config.md). The function and
// its auth/rate-limit middleware stay as scaffolding for future admin
// REST endpoints.

export const admin = onRequest({ cors: true }, adminApp);
