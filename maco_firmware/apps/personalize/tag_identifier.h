// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_async2/coro.h"
#include "pw_random/random.h"
#include "pw_result/result.h"

namespace maco::nfc {
class NfcReader;
}

namespace maco::secrets {
class DeviceSecrets;
}

namespace maco::personalize {

enum class TagType { kFactory, kMaCo, kUnknown };

struct TagIdentification {
  TagType type = TagType::kUnknown;
  std::array<std::byte, 7> uid{};
  size_t uid_size = 0;
};

/// Build a TagInfo from an NfcTag for use with Ntag424Tag.
inline nfc::TagInfo TagInfoFromNfcTag(const nfc::NfcTag& tag) {
  nfc::TagInfo info{};
  auto uid = tag.uid();
  info.uid_length = uid.size();
  std::copy(uid.begin(), uid.end(), info.uid.begin());
  info.sak = tag.sak();
  info.target_number = tag.target_number();
  info.supports_iso14443_4 = tag.supports_iso14443_4();
  return info;
}

/// Identify a tag by probing default and terminal keys.
///
/// Constructs an Ntag424Tag internally and attempts authentication with
/// the factory default key (key 0) and the provisioned terminal key (key 1).
/// Returns the authenticated UID (from GetCardUid) for factory and MaCo tags.
///
/// @return TagIdentification with type and UID on success
pw::async2::Coro<pw::Result<TagIdentification>> IdentifyTag(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag,
    nfc::NfcReader& reader,
    secrets::DeviceSecrets& device_secrets,
    pw::random::RandomGenerator& rng);

}  // namespace maco::personalize
