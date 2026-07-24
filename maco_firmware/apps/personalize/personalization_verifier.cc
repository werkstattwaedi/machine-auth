// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "VERIFY"

#include "maco_firmware/apps/personalize/personalization_verifier.h"

#include <algorithm>
#include <optional>

#include "maco_firmware/apps/personalize/sdm_constants.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "pw_log/log.h"

namespace maco::personalize {

namespace {

// ISO 14443-3: a random ID is single-size (4 bytes) with UID0 = 0x08. Real
// NTAG UIDs are 7 bytes starting with 0x04 (NXP). There is no readback for
// the PICC configuration, so the anticollision UID shape is the definitive
// check that Random ID is enabled.
constexpr size_t kRandomIdLength = 4;
constexpr std::byte kRandomIdFirstByte{0x08};

struct KeyCheck {
  uint8_t number;
  const char* name;
  pw::ConstByteSpan key;
};

void LogHex(const char* label, pw::ConstByteSpan data) {
  pw::StringBuffer<2 * sdm::kMaxNdefSize + 1> hex;
  for (std::byte b : data) {
    hex.Format("%02x", static_cast<unsigned>(b));
  }
  PW_LOG_WARN("%s: %s", label, hex.c_str());
}

}  // namespace

bool VerificationReport::AllOk() const {
  if (!random_uid_enabled || !read_checks_ran || !uid_matches ||
      !ndef_matches || !sdm_settings_ok) {
    return false;
  }
  return std::all_of(key_ok.begin(), key_ok.end(), [](bool ok) { return ok; });
}

void VerificationReport::FormatFailures(pw::StringBuilder& out) const {
  bool first = true;
  auto add = [&](const char* label) {
    if (!first) {
      out << ", ";
    }
    out << label;
    first = false;
  };

  if (!random_uid_enabled) {
    add("RandomUID");
  }
  static constexpr const char* kKeyLabels[kNumKeys] = {
      "Key0", "Key1", "Key2", "Key3", "Key4"};
  for (size_t i = 0; i < kNumKeys; ++i) {
    if (!key_ok[i]) {
      add(kKeyLabels[i]);
    }
  }
  if (!read_checks_ran) {
    add("Lese-Checks (kein Key0)");
    return;
  }
  if (!uid_matches) {
    add("UID");
  }
  if (!ndef_matches) {
    add("NDEF");
  }
  if (!sdm_settings_ok) {
    add("SDM");
  }
}

pw::async2::Coro<pw::Result<VerificationReport>> VerifyPersonalization(
    pw::async2::CoroContext cx,
    nfc::Ntag424Tag& ntag,
    pw::ConstByteSpan anticollision_uid,
    pw::ConstByteSpan expected_uid,
    const PersonalizationKeys& keys,
    pw::random::RandomGenerator& rng) {
  VerificationReport report;

  report.random_uid_enabled =
      anticollision_uid.size() == kRandomIdLength &&
      anticollision_uid[0] == kRandomIdFirstByte;
  if (!report.random_uid_enabled) {
    PW_LOG_WARN("Random UID not enabled (%u-byte anticollision UID)",
                static_cast<unsigned>(anticollision_uid.size()));
  }

  // Slot 0 last: its session is reused for the read checks below.
  const KeyCheck checks[] = {
      {1, "terminal", keys.terminal_key},
      {2, "authorization", keys.authorization_key},
      {3, "sdm_mac", keys.sdm_mac_key},
      {4, "reserved2", keys.reserved2_key},
      {0, "application", keys.application_key},
  };

  std::optional<nfc::Ntag424Session> session;
  for (const auto& check : checks) {
    // Re-select before every attempt: a failed AuthenticateEV2First clears
    // the tag's authentication state, so start each slot from scratch.
    auto select_status = co_await ntag.SelectApplication(cx);
    if (!select_status.ok()) {
      PW_LOG_ERROR("SelectApplication failed during verification: %d",
                   static_cast<int>(select_status.code()));
      co_return select_status;
    }

    nfc::LocalKeyProvider key_provider(check.number, check.key, rng);
    auto auth_result = co_await ntag.Authenticate(cx, key_provider);
    report.key_ok[check.number] = auth_result.ok();
    if (auth_result.ok()) {
      PW_LOG_INFO("Key %u (%s) verified",
                  static_cast<unsigned>(check.number), check.name);
      if (check.number == 0) {
        session = *auth_result;
      }
    } else {
      PW_LOG_WARN("Key %u (%s) MISMATCH: auth failed: %d",
                  static_cast<unsigned>(check.number), check.name,
                  static_cast<int>(auth_result.status().code()));
    }
  }

  if (!session.has_value()) {
    PW_LOG_WARN("Key 0 not verified — skipping UID/NDEF/SDM checks");
    co_return report;
  }
  report.read_checks_ran = true;

  // Real UID via GetCardUid (works regardless of Random ID).
  std::array<std::byte, 7> uid_buffer{};
  auto uid_result =
      co_await ntag.GetCardUid(cx, *session, pw::ByteSpan(uid_buffer));
  report.uid_matches =
      uid_result.ok() && *uid_result == expected_uid.size() &&
      std::equal(expected_uid.begin(), expected_uid.end(), uid_buffer.begin());
  if (!report.uid_matches) {
    PW_LOG_WARN("UID mismatch or GetCardUid failed");
  }

  auto template_result = sdm::BuildNdefTemplate(keys.sdm_base_url);
  if (!template_result.ok()) {
    PW_LOG_ERROR("Cannot build NDEF template for verification");
    co_return report;
  }
  const auto& ndef = *template_result;

  // File settings before the NDEF read: the NDEF file's read access is
  // free (Eh), so its plain-mode ReadData is served outside the secure
  // session. Keeping all MACed session commands ahead of it removes any
  // dependency on counter behavior across that boundary.
  std::array<std::byte, 32> settings_buffer{};
  auto settings_result = co_await ntag.GetFileSettings(
      cx, *session, sdm::kNdefFileNumber, settings_buffer);
  if (!settings_result.ok()) {
    PW_LOG_WARN("GetFileSettings failed: %d",
                static_cast<int>(settings_result.status().code()));
  } else {
    pw::ConstByteSpan settings(settings_buffer.data(), *settings_result);
    report.sdm_settings_ok = sdm::IsSdmConfigured(
        settings, ndef.picc_data_offset, ndef.sdm_mac_offset);
    if (!report.sdm_settings_ok) {
      LogHex("SDM settings on tag", settings);
      LogHex("SDM settings expected (ChangeFileSettings payload)",
             sdm::BuildSdmFileSettings(ndef.picc_data_offset,
                                       ndef.sdm_mac_offset));
    }
  }

  // Read back the NDEF file. Read access is free, so this read goes
  // through the same SDM path as a phone tap: the mirror regions come
  // back with live PICC data/CMAC (excluded from the compare) and each
  // chunk consumes one SDMReadCtr value — the counter cost of verifying.
  // Kept last: see the GetFileSettings ordering comment above.
  std::array<std::byte, sdm::kMaxNdefSize> read_buffer{};
  bool read_ok = true;
  size_t offset = 0;
  while (offset < ndef.size) {
    size_t chunk = std::min(sdm::kReadChunkSize, ndef.size - offset);
    auto read_result = co_await ntag.ReadData(
        cx, *session, sdm::kNdefFileNumber, offset, chunk,
        pw::ByteSpan(read_buffer.data() + offset, chunk),
        nfc::CommMode::kPlain);
    if (!read_result.ok() || *read_result != chunk) {
      PW_LOG_WARN("NDEF read at offset %u failed: %d (%u bytes)",
                  static_cast<unsigned>(offset),
                  static_cast<int>(read_result.status().code()),
                  read_result.ok() ? static_cast<unsigned>(*read_result) : 0u);
      read_ok = false;
      break;
    }
    offset += chunk;
  }
  report.ndef_matches =
      read_ok && sdm::NdefContentMatches(
                     pw::ConstByteSpan(read_buffer.data(), ndef.size), ndef);
  if (!report.ndef_matches) {
    PW_LOG_WARN("NDEF content mismatch");
    if (read_ok) {
      LogHex("NDEF on tag", pw::ConstByteSpan(read_buffer.data(), ndef.size));
      LogHex("NDEF expected", ndef.content());
    }
  }

  co_return report;
}

}  // namespace maco::personalize
