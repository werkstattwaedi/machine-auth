// Protocol Buffer types barrel export
// Re-export common types
export { Key, TagUid, KeyBytes } from "./proto/common.js";

// Re-export session types
export {
  TokenSession,
  StartSessionRequest,
  StartSessionResponse,
  AuthRequired,
  Rejected,
  AuthenticateNewSessionRequest,
  AuthenticateNewSessionResponse,
  CompleteAuthenticationRequest,
  CompleteAuthenticationResponse,
} from "./proto/firebase_rpc/session.js";

// Re-export usage types
export {
  MachineUsage,
  MachineUsageHistory,
  CheckOutReason,
  UploadUsageRequest,
  UploadUsageResponse,
} from "./proto/firebase_rpc/usage.js";

// Re-export personalization types
export {
  KeyDiversificationRequest,
  KeyDiversificationResponse,
} from "./proto/firebase_rpc/personalization.js";
