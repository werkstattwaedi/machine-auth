// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `courseCall` — grouped callable for the edoobox courses (#842, ADR-0028):
 * the course leader's Kursleitung pages and the admin's leader links.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { resendApiKey } from "../util/resend_template";
import { diversificationMasterKey } from "../config/tag-secrets";
import { EDOOBOX_SECRETS } from "./edoobox";
import {
  assignCourseBadgeHandler,
  checkParticipantEmailHandler,
  closeCourseHandler,
  getCourseHandler,
  linkParticipantHandler,
  listMyCoursesHandler,
  setAttendanceHandler,
  setCoursePermissionTypeHandler,
  setParticipantChoiceHandler,
} from "./handlers";
import {
  countLeaderCoursesHandler,
  listEdooboxLeadersHandler,
  setEdooboxLeaderHandler,
  unlinkCourseParticipantHandler,
} from "./admin_handlers";

const HANDLERS: Record<string, RpcHandler> = {
  listMyCourses: listMyCoursesHandler,
  getCourse: getCourseHandler,
  setCoursePermissionType: setCoursePermissionTypeHandler,
  setAttendance: setAttendanceHandler,
  checkParticipantEmail: checkParticipantEmailHandler,
  linkParticipant: linkParticipantHandler,
  assignCourseBadge: assignCourseBadgeHandler,
  setParticipantChoice: setParticipantChoiceHandler,
  closeCourse: closeCourseHandler,
  listEdooboxLeaders: listEdooboxLeadersHandler,
  countLeaderCourses: countLeaderCoursesHandler,
  setEdooboxLeader: setEdooboxLeaderHandler,
  unlinkCourseParticipant: unlinkCourseParticipantHandler,
};

// A course page reads several edoobox lists in a row.
export const courseCall = onCall(
  { secrets: [...EDOOBOX_SECRETS, resendApiKey, diversificationMasterKey], timeoutSeconds: 60 },
  (request) => dispatchRpc("course", HANDLERS, request)
);
