// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "SDM"

#include "maco_firmware/apps/personalize/sdm_configurator.h"

#include "maco_firmware/apps/personalize/sdm_constants.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_log/log.h"
#include "pw_status/try.h"

namespace maco::personalize {

pw::async2::Coro<pw::Status> ConfigureSdm(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const nfc::Ntag424Session& session) {
  PW_LOG_INFO("Checking SDM configuration...");

  // Step 1: Read current file settings to check if SDM is already enabled.
  // Use Full mode: during authenticated session, PICC expects CMAC on commands.
  std::array<std::byte, 32> settings_buf{};
  auto settings_result = co_await ntag.GetFileSettings(
      cx, session, sdm::kNdefFileNumber, settings_buf);
  if (settings_result.ok()) {
    if (sdm::IsSdmConfigured(
            pw::ConstByteSpan(settings_buf.data(), *settings_result))) {
      PW_LOG_INFO("SDM already configured — skipping");
      co_return pw::OkStatus();
    }
    PW_LOG_INFO("File settings read (%u bytes), SDM not yet configured",
                static_cast<unsigned>(*settings_result));
  } else {
    PW_LOG_WARN("GetFileSettings failed: %d (continuing with write)",
                static_cast<int>(settings_result.status().code()));
  }

  // Step 2: Write NDEF URL template in 2 chunks (plain mode)
  PW_LOG_INFO("Writing NDEF URL template...");

  pw::ConstByteSpan part1(sdm::kNdefTemplate.data(), sdm::kWriteChunkSize);
  auto write1_status = co_await ntag.WriteData(
      cx, session, sdm::kNdefFileNumber, 0, part1, nfc::CommMode::kPlain);
  if (!write1_status.ok()) {
    PW_LOG_ERROR("NDEF write part 1 failed: %d",
                 static_cast<int>(write1_status.code()));
    co_return write1_status;
  }

  pw::ConstByteSpan part2(sdm::kNdefTemplate.data() + sdm::kWriteChunkSize,
                          sdm::kNdefTotalSize - sdm::kWriteChunkSize);
  auto write2_status = co_await ntag.WriteData(
      cx, session, sdm::kNdefFileNumber, sdm::kWriteChunkSize, part2,
      nfc::CommMode::kPlain);
  if (!write2_status.ok()) {
    PW_LOG_ERROR("NDEF write part 2 failed: %d",
                 static_cast<int>(write2_status.code()));
    co_return write2_status;
  }

  // Step 3: Enable SDM via ChangeFileSettings.
  // Command is always Full mode (encrypted). Response follows file's current
  // CommMode (Plain), since the file hasn't changed CommMode yet.
  PW_LOG_INFO("Enabling SDM...");
  auto change_status = co_await ntag.ChangeFileSettings(
      cx, session, sdm::kNdefFileNumber, sdm::kSdmFileSettings,
      nfc::CommMode::kPlain);
  if (!change_status.ok()) {
    PW_LOG_ERROR("ChangeFileSettings failed: %d",
                 static_cast<int>(change_status.code()));
    co_return change_status;
  }

  // Step 4: Verify SDM is enabled
  std::array<std::byte, 32> verify_buf{};
  auto verify_result = co_await ntag.GetFileSettings(
      cx, session, sdm::kNdefFileNumber, verify_buf);
  if (!verify_result.ok()) {
    PW_LOG_WARN("Verification GetFileSettings failed: %d",
                static_cast<int>(verify_result.status().code()));
    // SDM was written successfully, verification is best-effort
    co_return pw::OkStatus();
  }

  if (!sdm::IsSdmConfigured(
          pw::ConstByteSpan(verify_buf.data(), *verify_result))) {
    PW_LOG_ERROR("SDM verification failed — settings don't match expected");
    co_return pw::Status::Internal();
  }

  PW_LOG_INFO("SDM configured and verified");
  co_return pw::OkStatus();
}

}  // namespace maco::personalize
