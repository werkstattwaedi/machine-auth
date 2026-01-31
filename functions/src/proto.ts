// Protocol Buffer types barrel export
// Re-export common types
export { Key, TagUid, KeyBytes, FirebaseId } from "./proto/common.js";

// Re-export auth types
export {
  SessionKeys,
  Rejected,
  Authorized,
  TerminalCheckinRequest,
  TerminalCheckinResponse,
  AuthenticateTagRequest,
  AuthenticateTagResponse,
  CompleteTagAuthRequest,
  CompleteTagAuthResponse,
} from "./proto/firebase_rpc/auth.js";

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
