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
    const nfc::Ntag424Session& session,
    std::string_view base_url) {
  PW_LOG_INFO("Building NDEF template (%u char base URL)",
              static_cast<unsigned>(base_url.size()));

  auto template_result = sdm::BuildNdefTemplate(base_url);
  if (!template_result.ok()) {
    PW_LOG_ERROR("Failed to build NDEF template (URL too long?)");
    co_return template_result.status();
  }

  const auto& ndef = *template_result;
  const auto file_settings = sdm::BuildSdmFileSettings(
      ndef.picc_data_offset, ndef.sdm_mac_offset);

  // Step 1: Check if SDM is already configured with correct offsets.
  PW_LOG_INFO("Checking SDM configuration...");
  std::array<std::byte, 32> settings_buf{};
  auto settings_result = co_await ntag.GetFileSettings(
      cx, session, sdm::kNdefFileNumber, settings_buf);
  if (settings_result.ok()) {
    if (sdm::IsSdmConfigured(
            pw::ConstByteSpan(settings_buf.data(), *settings_result),
            ndef.picc_data_offset, ndef.sdm_mac_offset)) {
      PW_LOG_INFO("SDM already configured — skipping");
      co_return pw::OkStatus();
    }
    PW_LOG_INFO("File settings read (%u bytes), SDM not yet configured",
                static_cast<unsigned>(*settings_result));
  } else {
    PW_LOG_WARN("GetFileSettings failed: %d (continuing with write)",
                static_cast<int>(settings_result.status().code()));
  }

  // Step 2: Write NDEF URL template in chunks
  PW_LOG_INFO("Writing NDEF URL template (%u bytes)...",
              static_cast<unsigned>(ndef.size));

  size_t offset = 0;
  while (offset < ndef.size) {
    size_t chunk = std::min(sdm::kWriteChunkSize, ndef.size - offset);
    pw::ConstByteSpan data(ndef.data.data() + offset, chunk);
    auto write_status = co_await ntag.WriteData(
        cx, session, sdm::kNdefFileNumber, offset, data,
        nfc::CommMode::kPlain);
    if (!write_status.ok()) {
      PW_LOG_ERROR("NDEF write at offset %u failed: %d",
                   static_cast<unsigned>(offset),
                   static_cast<int>(write_status.code()));
      co_return write_status;
    }
    offset += chunk;
  }

  // Step 3: Enable SDM via ChangeFileSettings.
  PW_LOG_INFO("Enabling SDM (picc_offset=0x%02x, mac_offset=0x%02x)...",
              ndef.picc_data_offset, ndef.sdm_mac_offset);
  auto change_status = co_await ntag.ChangeFileSettings(
      cx, session, sdm::kNdefFileNumber, file_settings,
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
    co_return pw::OkStatus();
  }

  if (!sdm::IsSdmConfigured(
          pw::ConstByteSpan(verify_buf.data(), *verify_result),
          ndef.picc_data_offset, ndef.sdm_mac_offset)) {
    PW_LOG_ERROR("SDM verification failed — settings don't match expected");
    co_return pw::Status::Internal();
  }

  PW_LOG_INFO("SDM configured and verified");
  co_return pw::OkStatus();
}

}  // namespace maco::personalize
